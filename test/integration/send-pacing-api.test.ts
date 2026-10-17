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
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import type { StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Dàn đều (ADR-0032 GĐ 2): lúc nhận, mỗi thư giữ một lượt trong phút còn chỗ (đếm trên Redis thật) -> thư
 * vượt mức là `scheduled` tới lượt của nó, job `promote-scheduled` thả ra. Mỗi test một app riêng: lượt đã giữ
 * nằm trên Redis theo app, không dọn giữa các test.
 * Đồng hồ giả: 2026-10-16 là thứ Sáu (giờ Việt Nam UTC+7).
 */
const vn = (iso: string) => new Date(`${iso}+07:00`);
let now = vn('2026-10-16T10:00:00');

let ADMIN_TOKEN: string;
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let mail: MockEmailProvider;
let worker: StreamConsumer;
const USERS = ['u1', 'u2', 'u3', 'u4', 'u5'];

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
});
beforeEach(() => {
  mail.reset();
  now = vn('2026-10-16T10:00:00');
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

function admin(method: string, path: string, body?: unknown) {
  return http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
}

/** App mới có topic thường + topic bắt buộc và 5 người nhận. */
async function newApp(slug: string) {
  const app = await provisionApp(api.url, ADMIN_TOKEN, slug);
  const v1 = (method: string, path: string, body?: unknown) =>
    http(method, `/v1${path}`, body === undefined ? { token: app.apiKey } : { token: app.apiKey, body });
  for (const [key, mandatory] of [
    ['promo', false],
    ['incident', true],
  ] as const) {
    await admin('POST', `/apps/${app.appId}/topics`, { key, name: key, mandatory });
    await admin('POST', `/apps/${app.appId}/topics/${key}/activate`);
  }
  for (const id of USERS) await v1('PUT', `/users/${id}`, { email: `${id}@company.com` });
  return {
    ...app,
    v1,
    pacing: (perMinute: number | null, mandatoryBypass = true) =>
      admin('PUT', `/apps/${app.appId}/pacing`, { perMinute, mandatoryBypass }),
    send: (externalId: string, topic: string) =>
      v1('POST', '/notifications', { to: { externalId }, topic, subject: 'Chào', html: '<p>Chào</p>' }),
    publish: (topic: string, key: string) => v1('POST', '/publications', { topic, idempotencyKey: key, subject: 'KM', html: '<p>KM</p>' }),
  };
}

async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  while ((await worker.pollOnce(0)).processed > 0);
}
const promote = () => moduleJobs(application).find((j) => j.name === 'promote-scheduled')!.run();

describe('Dàn đều (ADR-0032 GĐ 2)', () => {
  it('mặc định không dàn; đặt sai -> 422 PACING_INVALID; trần do Super Admin đặt hiện trong AppDto', async () => {
    const app = await newApp('pace-config');
    expect((await admin('GET', `/apps/${app.appId}`)).body).toMatchObject({
      sendPerMinute: null,
      mandatoryBypassPacing: true,
      maxSendPerMinute: null,
    });
    const zero = await app.pacing(0);
    expect(zero.status).toBe(422);
    expect(JSON.stringify(zero.body)).toContain('PACING_INVALID');
    expect((await app.pacing(1001)).status).toBe(422);

    expect((await admin('PUT', `/apps/${app.appId}/pacing-ceiling`, { maxPerMinute: 50 })).body).toMatchObject({ maxSendPerMinute: 50 });
    expect((await app.pacing(60)).status).toBe(422);
    expect((await app.pacing(30, false)).body).toMatchObject({ sendPerMinute: 30, mandatoryBypassPacing: false, maxSendPerMinute: 50 });
  });

  it('phát vào chủ đề 5 người, 2 thư/phút: 1 đi ngay, còn lại rải 30 giây một thư, job thả đúng lượt', async () => {
    const app = await newApp('pace-pub');
    await app.pacing(2);

    const res = await app.publish('promo', 'pub-1');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      counts: { pending: 5 },
      scheduledAt: vn('2026-10-16T10:00:30').toISOString(),
      lastScheduledAt: vn('2026-10-16T10:02:00').toISOString(),
    });
    await deliver();
    expect(mail.delivered).toHaveLength(1);

    now = vn('2026-10-16T10:01:05');
    await promote();
    await deliver();
    expect(mail.delivered).toHaveLength(3);

    now = vn('2026-10-16T10:02:00');
    await promote();
    await deliver();
    expect(mail.delivered.map((m) => m.to).sort()).toEqual(USERS.map((u) => `${u}@company.com`));
  });

  it('gửi lẻ nối tiếp nhau cũng chia lượt chung; tin bắt buộc không phải chờ', async () => {
    const app = await newApp('pace-single');
    await app.pacing(1);
    expect((await app.send('u1', 'promo')).body).toMatchObject({ status: 'queued', scheduledAt: null });
    expect((await app.send('u2', 'promo')).body).toMatchObject({ status: 'scheduled', scheduledAt: vn('2026-10-16T10:01:00').toISOString() });
    expect((await app.send('u3', 'promo')).body).toMatchObject({ scheduledAt: vn('2026-10-16T10:02:00').toISOString() });
    expect((await app.send('u4', 'incident')).body).toMatchObject({ status: 'queued', scheduledAt: null });

    // Tắt ngoại lệ -> tin bắt buộc xếp sau thư thường.
    await app.pacing(1, false);
    expect((await app.send('u5', 'incident')).body).toMatchObject({ scheduledAt: vn('2026-10-16T10:03:00').toISOString() });
  });

  it('trần Super Admin áp cả tin bắt buộc', async () => {
    const app = await newApp('pace-ceiling');
    await admin('PUT', `/apps/${app.appId}/pacing-ceiling`, { maxPerMinute: 1 });
    expect((await app.send('u1', 'incident')).body).toMatchObject({ status: 'queued' });
    expect((await app.send('u2', 'incident')).body).toMatchObject({ status: 'scheduled', scheduledAt: vn('2026-10-16T10:01:00').toISOString() });
  });

  it('khung giờ + dàn đều: thư chờ qua đêm đi rải từ lúc khung mở, không dồn', async () => {
    const app = await newApp('pace-window');
    await admin('PUT', `/apps/${app.appId}/send-window`, {
      window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' },
      mandatoryBypass: true,
    });
    await app.pacing(2);
    now = vn('2026-10-16T22:00:00');
    const res = await app.publish('promo', 'pub-night');
    expect(res.body).toMatchObject({
      counts: { pending: 5 },
      scheduledAt: vn('2026-10-19T08:00:00').toISOString(),
      lastScheduledAt: vn('2026-10-19T08:02:00').toISOString(),
    });
  });
});
