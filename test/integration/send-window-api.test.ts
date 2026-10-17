import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApplication,
  consumerRegistry,
  createContainer,
  moduleJobs,
  type Application,
  type Container,
} from '../../src/composition/index.ts';
import { MockEmailProvider } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import { auditLog } from '../../src/modules/audit/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import type { StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Khung giờ gửi (ADR-0032): thư nhận ngoài khung -> `scheduled` tới lúc khung mở, job `promote-scheduled`
 * thả ra `queued`, worker gửi như thường. Tin bắt buộc bỏ qua khung khi app cho phép.
 * Đồng hồ giả: 2026-10-16 là thứ Sáu (giờ Việt Nam UTC+7).
 */
const vn = (iso: string) => new Date(`${iso}+07:00`);
const FRIDAY_NIGHT = vn('2026-10-16T22:00:00');
const MONDAY_OPEN = vn('2026-10-19T08:00:00');
let now = FRIDAY_NIGHT;

let ADMIN_TOKEN: string;
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let mail: MockEmailProvider;
let worker: StreamConsumer;
let shop: { appId: string; apiKey: string };

const OFFICE_HOURS = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' };

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 12 });
  c = createContainer(
    loadEnv({
      DATABASE_URL: t.url,
      REDIS_URL: await testRedisUrl(),
      LOG_LEVEL: 'fatal',
      HOST: '127.0.0.1',
      PORT: '0',
      EMAIL_MAX_PER_MINUTE: '10000',
    }),
    { database: t, redis: await createTestRedis(), clock: { now: () => new Date(now) } },
  );
  mail = new MockEmailProvider({ logger: c.ports.logger });
  application = buildApplication(c, { emailProvider: mail });
  api = await startApi(c, application);
  ADMIN_TOKEN = (await signInAdmin(application, api.url)).token;
  http = httpClient(api.url);
  const r = consumerRegistry(application).find((x) => x.group === 'email-sender')!;
  worker = c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'w1', handler: r.handler, batchSize: 10 });
  await worker.ensureGroup();

  shop = await provisionApp(api.url, ADMIN_TOKEN, 'shop');
  for (const [key, mandatory] of [
    ['promo', false],
    ['incident', true],
  ] as const) {
    await admin('POST', `/apps/${shop.appId}/topics`, { key, name: key, mandatory });
    await admin('POST', `/apps/${shop.appId}/topics/${key}/activate`);
  }
  for (const id of ['u1', 'u2']) await v1('PUT', `/users/${id}`, { email: `${id}@company.com` });
});
beforeEach(() => {
  mail.reset();
  now = FRIDAY_NIGHT;
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

function admin(method: string, path: string, body?: unknown) {
  return http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
}
const v1 = (method: string, path: string, body?: unknown) =>
  http(method, `/v1${path}`, body === undefined ? { token: shop.apiKey } : { token: shop.apiKey, body });
const setWindow = (window: unknown, mandatoryBypass = true) =>
  admin('PUT', `/apps/${shop.appId}/send-window`, { window, mandatoryBypass });

async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  while ((await worker.pollOnce(0)).processed > 0);
}
const send = (externalId: string, topic: string) =>
  v1('POST', '/notifications', { to: { externalId }, topic, subject: 'Chào', html: '<p>Chào</p>' });
const promote = () => moduleJobs(application).find((j) => j.name === 'promote-scheduled')!.run();

describe('Khung giờ gửi (ADR-0032)', () => {
  it('mặc định không có khung; đặt sai -> 422 có mã; đặt đúng -> AppDto + audit', async () => {
    const app = (await admin('GET', `/apps/${shop.appId}`)).body;
    expect(app).toMatchObject({ sendWindow: null, mandatoryBypassWindow: true });

    const empty = await setWindow({ days: [1], start: '18:00', end: '08:00' });
    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty.body)).toContain('SEND_WINDOW_EMPTY');
    expect((await setWindow({ days: [], start: '08:00', end: '18:00' })).status).toBe(422);

    const ok = await setWindow({ ...OFFICE_HOURS, days: [5, 1, 2, 3, 4] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sendWindow: OFFICE_HOURS, mandatoryBypassWindow: true });

    await c.infra.outboxRelay.relayOnce();
    const audit = consumerRegistry(application).find((x) => x.group === 'audit-writer')!;
    const auditWorker = c.infra.createConsumer({ ...audit.options, stream: audit.stream, group: audit.group, consumer: 'a1', handler: audit.handler });
    await auditWorker.ensureGroup();
    while ((await auditWorker.pollOnce(0)).processed > 0);
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, 'AppSendWindowChanged'));
    expect(rows.at(-1)?.afterData).toMatchObject({ sendWindow: OFFICE_HOURS });
  });

  it('ngoài khung: thư thường chờ tới sáng thứ Hai; tin bắt buộc đi ngay', async () => {
    await setWindow(OFFICE_HOURS);

    const promo = await send('u1', 'promo');
    expect(promo.status).toBe(202);
    expect(promo.body).toMatchObject({ status: 'scheduled', scheduledAt: MONDAY_OPEN.toISOString(), queuedAt: null });

    const incident = await send('u2', 'incident');
    expect(incident.body).toMatchObject({ status: 'queued', scheduledAt: null });

    await deliver();
    expect(mail.delivered.map((m) => m.to)).toEqual(['u2@company.com']);
    expect((await v1('GET', `/notifications/${promo.body['id']}`)).body['status']).toBe('scheduled');

    // Chưa tới giờ: job không thả.
    await promote();
    await deliver();
    expect(mail.delivered).toHaveLength(1);

    // Thứ Hai 08:00:10 -> thả, gửi.
    now = new Date(MONDAY_OPEN.getTime() + 10_000);
    await promote();
    await deliver();
    expect(mail.delivered.map((m) => m.to)).toEqual(['u2@company.com', 'u1@company.com']);
    const sent = (await v1('GET', `/notifications/${promo.body['id']}`)).body;
    expect(sent).toMatchObject({ status: 'sent', scheduledAt: MONDAY_OPEN.toISOString(), queuedAt: now.toISOString() });
  });

  it('trong khung -> gửi ngay', async () => {
    await setWindow(OFFICE_HOURS);
    now = vn('2026-10-16T10:00:00');
    const res = await send('u1', 'promo');
    expect(res.body).toMatchObject({ status: 'queued', scheduledAt: null });
  });

  it('tắt ngoại lệ tin bắt buộc -> tin bắt buộc cũng chờ', async () => {
    await setWindow(OFFICE_HOURS, false);
    const res = await send('u2', 'incident');
    expect(res.body).toMatchObject({ status: 'scheduled', scheduledAt: MONDAY_OPEN.toISOString() });
  });

  it('phát vào topic ngoài khung: mọi thư con cùng chờ, lần phát còn in_progress', async () => {
    await setWindow(OFFICE_HOURS);
    const res = await v1('POST', '/publications', { topic: 'promo', idempotencyKey: 'pub-1', subject: 'Khuyến mãi', html: '<p>KM</p>' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'in_progress', counts: { pending: 2 }, scheduledAt: MONDAY_OPEN.toISOString() });
    for (const r of res.body['recipients'] as { notificationId: string }[]) {
      expect((await v1('GET', `/notifications/${r.notificationId}`)).body['status']).toBe('scheduled');
    }
  });

  it('bỏ khung -> gửi mọi lúc', async () => {
    expect((await setWindow(null)).body).toMatchObject({ sendWindow: null });
    const res = await send('u1', 'promo');
    expect(res.body).toMatchObject({ status: 'queued' });
  });
});
