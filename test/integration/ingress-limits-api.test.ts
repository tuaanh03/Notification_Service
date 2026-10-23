import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApplication,
  consumerRegistry,
  createContainer,
  type Application,
  type Container,
} from '../../src/composition/index.ts';
import { MockEmailProvider } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import { vnDayWindow } from '../../src/modules/notifications/domain/rules/send-limits.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { STREAMS, type StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Cửa nhận khi có nhiều app (ADR-0041): số lần gọi API gửi mỗi phút, trần mỗi giờ mặc định cho app mới, làn ưu tiên cho
 * tin bắt buộc, trần ngày của hộp gửi chung, trần hàng chờ mỗi app, màn Hàng chờ gửi. Đồng hồ giả, giờ Việt Nam UTC+7.
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
let workers: StreamConsumer[];

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
  workers = ['email-sender', 'email-sender-priority'].map((group) => {
    const r = consumerRegistry(application).find((x) => x.group === group)!;
    return c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'w1', handler: r.handler, batchSize: 10 });
  });
  for (const w of workers) await w.ensureGroup();
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
const setSettings = (values: Record<string, unknown>) => admin('PUT', '/system-settings', { values });

/** App mới có topic thường `promo` + topic bắt buộc `incident` và một người nhận. */
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
  await v1('PUT', '/users/u1', { email: 'u1@company.com' });
  return {
    ...app,
    send: (topic: string) => v1('POST', '/notifications', { to: { externalId: 'u1' }, topic, subject: 'Chào', html: '<p>Chào</p>' }),
    status: async (id: string) => (await v1('GET', `/notifications/${id}`)).body['status'],
    apiRate: (perMinute: number) => admin('PUT', `/apps/${app.appId}/api-rate-limit`, { perMinute }),
  };
}

async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  for (const w of workers) while ((await w.pollOnce(0)).processed > 0);
}
const inStream = async (stream: string, id: string) => (await c.infra.streams.range(stream)).some((e) => e.fields.includes(id));

describe('Trần mỗi giờ mặc định cho app mới (ADR-0041)', () => {
  it('app mới nhận trần 600 thư / giờ; cài đặt = 0 thì app mới không có trần', async () => {
    const first = await newApp('default-ceiling');
    expect((await admin('GET', `/apps/${first.appId}`)).body).toMatchObject({ maxSendPerHour: 600 });

    expect((await setSettings({ 'apps.default_max_send_per_hour': 0 })).status).toBe(200);
    const second = await newApp('no-ceiling');
    expect((await admin('GET', `/apps/${second.appId}`)).body).toMatchObject({ maxSendPerHour: null });
    // App đã có không bị đổi theo cài đặt.
    expect((await admin('GET', `/apps/${first.appId}`)).body).toMatchObject({ maxSendPerHour: 600 });
    await setSettings({ 'apps.default_max_send_per_hour': null });
  });
});

describe('Số lần gọi API gửi mỗi phút (ADR-0041)', () => {
  it('quá mức -> 429 APP_RATE_LIMITED kèm Retry-After; sang phút sau gửi lại được', async () => {
    const app = await newApp('api-rate');
    expect((await app.apiRate(0)).status).toBe(422);
    expect(JSON.stringify((await app.apiRate(0)).body)).toContain('API_RATE_LIMIT_INVALID');
    expect((await app.apiRate(2)).body).toMatchObject({ rateLimitPerMinute: 2 });

    now = vn('2026-10-16T10:00:45');
    expect((await app.send('promo')).status).toBe(202);
    expect((await app.send('promo')).status).toBe(202);
    const over = await app.send('promo');
    expect(over.status).toBe(429);
    expect(JSON.stringify(over.body)).toContain('APP_RATE_LIMITED');
    expect(over.headers.get('retry-after')).toBe('15');

    now = vn('2026-10-16T10:01:00');
    expect((await app.send('promo')).status).toBe(202);
  });
});

describe('Làn ưu tiên cho tin bắt buộc (ADR-0041)', () => {
  it('tin bắt buộc vào notif.queued.priority, thư thường vào notif.queued; worker gửi cả hai', async () => {
    const app = await newApp('priority-lane');
    const urgent = (await app.send('incident')).body['id'] as string;
    const normal = (await app.send('promo')).body['id'] as string;
    while ((await c.infra.outboxRelay.relayOnce()) > 0);
    expect(await inStream(STREAMS.NOTIF_QUEUED_PRIORITY, urgent)).toBe(true);
    expect(await inStream(STREAMS.NOTIF_QUEUED, urgent)).toBe(false);
    expect(await inStream(STREAMS.NOTIF_QUEUED, normal)).toBe(true);
    expect(await inStream(STREAMS.NOTIF_QUEUED_PRIORITY, normal)).toBe(false);

    await deliver();
    expect([await app.status(urgent), await app.status(normal)]).toEqual(['sent', 'sent']);
  });
});

describe('Trần hàng chờ mỗi app (ADR-0041)', () => {
  it('đủ trần thư chưa xong -> 429 APP_QUEUE_FULL; gửi bớt đi thì nhận lại', async () => {
    const app = await newApp('queue-full');
    await app.apiRate(1000);
    await setSettings({ 'apps.max_pending_per_app': 100 });
    for (let i = 0; i < 100; i += 1) expect((await app.send('promo')).status).toBe(202);
    const full = await app.send('promo');
    expect(full.status).toBe(429);
    expect(JSON.stringify(full.body)).toContain('APP_QUEUE_FULL');
    expect(full.headers.get('retry-after')).toBe('60');

    const queue = await admin('GET', '/delivery-queue');
    expect(queue.status).toBe(200);
    const row = (queue.body['apps'] as { appId: string; queued: number }[]).find((a) => a.appId === app.appId);
    expect(row).toMatchObject({ queued: 100, name: 'App queue-full', slug: 'queue-full' });
    expect(queue.body['maxPendingPerApp']).toBe(100);

    await deliver();
    expect((await app.send('promo')).status).toBe(202);
    await deliver();
    await setSettings({ 'apps.max_pending_per_app': null });
  });
});

describe('Trần ngày của hộp gửi chung (ADR-0041)', () => {
  it('ngày đã đủ trần: thư thường dời sang 0 giờ hôm sau, tin bắt buộc vẫn đi ngay; màn Hàng chờ thấy số đã dùng', async () => {
    now = vn('2026-10-16T15:00:00');
    const app = await newApp('daily-cap');
    await setSettings({ 'delivery.mailbox_daily_cap': 100 });
    // Giả lập hôm nay đã giữ đủ 100 lượt.
    await c.infra.redis.client.set(`mailbox:day:${vnDayWindow(now).startMs}`, '100');

    const later = await app.send('promo');
    expect(later.status).toBe(202);
    expect(later.body).toMatchObject({ status: 'scheduled', scheduledAt: vn('2026-10-17T00:00:00').toISOString() });
    expect((await app.send('incident')).body).toMatchObject({ status: 'queued' });

    const queue = (await admin('GET', '/delivery-queue')).body;
    expect(queue['mailbox']).toMatchObject({ usedToday: 101, dailyCap: 100, perMinute: 10000, priorityReservePerMinute: 5 });
    const row = (queue['apps'] as { appId: string }[]).find((a) => a.appId === app.appId);
    expect(row).toMatchObject({ scheduled: 1, queued: 1 });
    await setSettings({ 'delivery.mailbox_daily_cap': null });
  });

  it('chỉ Super Admin xem được màn Hàng chờ gửi', async () => {
    expect((await http('GET', '/admin/delivery-queue', {})).status).toBe(401);
  });
});
