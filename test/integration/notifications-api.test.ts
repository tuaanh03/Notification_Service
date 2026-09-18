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
import { notifications, notificationTransitions } from '../../src/modules/notifications/infrastructure/db/schema.ts';
import { subscriptions } from '../../src/modules/subscriptions/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { decodeMessage, STREAMS, type StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

const ADMIN_TOKEN = 'notifications-test-admin-'.padEnd(40, 'x');

let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let mail: MockEmailProvider;
let worker: StreamConsumer;
let shop: { appId: string; apiKey: string };

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 12 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0', ADMIN_TOKEN }),
    { database: t, redis: await createTestRedis() },
  );
  mail = new MockEmailProvider({ logger: c.ports.logger });
  application = buildApplication(c, { emailProvider: mail });
  api = await startApi(c, application);
  http = httpClient(api.url);
  worker = emailSender('w1');
  await worker.ensureGroup();

  shop = await provisionApp(api.url, ADMIN_TOKEN, 'shop');
  for (const [key, mandatory, defaultMode] of [
    ['auth_security', true, 'opt_out'],
    ['order_updates', false, 'opt_out'],
    ['newsletter_digest', false, 'opt_in'],
  ] as const) {
    await admin('POST', `/apps/${shop.appId}/topics`, { key, name: key, mandatory, defaultMode });
    await admin('POST', `/apps/${shop.appId}/topics/${key}/activate`);
  }
  await admin('POST', `/apps/${shop.appId}/topics`, { key: 'drafted', name: 'drafted' });
});
beforeEach(() => mail.reset());
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

function admin(method: string, path: string, body?: unknown) {
  return http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
}
const v1 = (method: string, path: string, body?: unknown, apiKey = shop.apiKey) =>
  http(method, `/v1${path}`, body === undefined ? { token: apiKey } : { token: apiKey, body });

/** Consumer THẬT của worker (group email-sender, idempotency: 'handler') lấy từ registry của ứng dụng. */
function emailSender(name: string): StreamConsumer {
  const registration = consumerRegistry(application).find((r) => r.group === 'email-sender')!;
  return c.infra.createConsumer({ ...registration.options, stream: registration.stream, group: registration.group, consumer: name, handler: registration.handler, batchSize: 1 });
}
/** scheduler relay outbox -> stream, rồi worker xử lý hết message đang chờ. */
async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  while ((await worker.pollOnce(0)).processed > 0);
}
async function user(externalId: string, email?: string): Promise<void> {
  expect([200, 201]).toContain((await v1('PUT', `/users/${externalId}`, email ? { email } : undefined)).status);
}
const send = (externalId: string, extra: Record<string, unknown> = {}) =>
  v1('POST', '/notifications', {
    to: { externalId },
    topic: 'order_updates',
    subject: 'Đơn OS10527 đã giao',
    html: '<p>Đơn của bạn đã giao.</p>',
    text: 'Đơn của bạn đã giao.',
    ...extra,
  });
const status = async (id: string) => (await v1('GET', `/notifications/${id}`)).body;

describe('POST /v1/notifications -> worker -> Mock', () => {
  it('202 queued -> worker gửi đúng 1 thư -> GET sent; lịch sử 2 bước trong notification_transitions', async () => {
    await user('emp_ok', 'emp.ok@company.com');
    const res = await send('emp_ok');
    expect(res.status).toBe(202);
    expect(res.headers.get('location')).toBe(`/v1/notifications/${res.body['id']}`);
    expect(res.body).toMatchObject({ status: 'queued', topic: 'order_updates', recipient: null });

    await deliver();
    expect(mail.delivered).toEqual([
      expect.objectContaining({ to: 'emp.ok@company.com', subject: 'Đơn OS10527 đã giao', notificationId: res.body['id'] }),
    ]);
    const done = await status(res.body['id'] as string);
    expect(done).toMatchObject({ status: 'sent', recipient: { address: 'emp.ok@company.com', status: 'sent', exclusionReason: null } });
    expect(done['sendingAt']).not.toBeNull();
    expect(done['finishedAt']).not.toBeNull();

    const steps = await t.db.select().from(notificationTransitions).where(eq(notificationTransitions.notificationId, res.body['id'] as string));
    expect(steps.map((s) => `${s.fromStatus}->${s.toStatus}`).sort()).toEqual(['queued->sending', 'sending->sent']);
  });

  it('trùng idempotencyKey -> 200 bản cũ; chỉ 1 thư', async () => {
    await user('emp_idem', 'emp.idem@company.com');
    const first = await send('emp_idem', { idempotencyKey: 'order-OS1-shipped' });
    const again = await send('emp_idem', { idempotencyKey: 'order-OS1-shipped' });
    expect([first.status, again.status]).toEqual([202, 200]);
    expect(again.body['id']).toBe(first.body['id']);
    await deliver();
    expect(mail.delivered).toHaveLength(1);
  });

  it('lỗi input -> 422 với mã rõ ràng, không xếp hàng gì', async () => {
    await user('emp_input', 'emp.input@company.com');
    const code = async (body: Record<string, unknown>) => ((await send('emp_input', body)).body['issues'] as Json[])[0]!['code'];
    expect(((await send('ghost')).body['issues'] as Json[])[0]).toMatchObject({ code: 'RECIPIENT_NOT_FOUND', path: 'to.externalId' });
    expect(await code({ topic: 'nope' })).toBe('TOPIC_NOT_FOUND');
    expect(await code({ topic: 'drafted' })).toBe('TOPIC_NOT_ACTIVE');
    expect(await code({ subject: 'Hi\r\nBcc: x@evil.test' })).toBe('EMAIL_SUBJECT_INVALID');
  });

  it('HTML 300 KB qua được (bodyLimit riêng của route)', async () => {
    await user('emp_big', 'emp.big@company.com');
    expect((await send('emp_big', { html: `<p>${'x'.repeat(250 * 1024)}</p>` })).status).toBe(202);
    await deliver();
    expect(mail.delivered).toHaveLength(1);
  });

  it('app không được cấp kênh email -> 422 CHANNEL_NOT_GRANTED', async () => {
    const account = (await admin('POST', '/accounts', { name: 'NoMail' })).body;
    const org = (await admin('POST', `/accounts/${account['id']}/organizations`, { name: 'NoMail' })).body;
    const app = (await admin('POST', '/apps', { orgId: org['id'], slug: 'inapp', name: 'In-app only', namespace: 'inapp' })).body;
    await admin('POST', `/apps/${app['id']}/submit`);
    await admin('POST', `/apps/${app['id']}/approve`, { grantedChannels: ['in_app'] });
    const key = (await admin('POST', `/apps/${app['id']}/secrets`)).body['apiKey'] as string;
    const res = await v1('POST', '/notifications', { to: { externalId: 'x' }, topic: 't', subject: 's', html: 'h' }, key);
    expect((res.body['issues'] as Json[])[0]).toMatchObject({ code: 'CHANNEL_NOT_GRANTED' });
  });
});

// Consent kiểm ở WORKER, ngay trước lúc gửi (ADR-0016 D7) — bằng đúng rule L0/L1/L3 có sẵn.
describe('gate L0 / L1 / L3', () => {
  async function outcome(externalId: string, topic = 'order_updates') {
    const res = await send(externalId, { topic });
    await deliver();
    return status(res.body['id'] as string);
  }

  it.each([
    ['tắt topic', 'g_topic_off', async () => void (await v1('PUT', '/users/g_topic_off/preferences', { topics: { order_updates: false } })), 'order_updates', 'opted_out'],
    ['topic opt_in chưa chọn', 'g_optin', async () => undefined, 'newsletter_digest', 'opted_out'],
    ['tắt mọi tin không bắt buộc', 'g_l1', async () => void (await v1('PUT', '/users/g_l1/preferences', { optedOutOptional: true })), 'order_updates', 'opted_out_optional'],
    ['user tự ngắt email + topic mandatory', 'g_unsub', async () => void (await v1('DELETE', '/users/g_unsub/email')), 'auth_security', 'suppressed'],
  ])('%s -> no_recipient / %s', async (_name, externalId, setup, topic, reason) => {
    await user(externalId, `${externalId}@company.com`);
    await setup();
    const n = await outcome(externalId, topic);
    expect(n).toMatchObject({ status: 'no_recipient', recipient: { status: 'skipped', exclusionReason: reason } });
    expect(mail.attempts).toHaveLength(0);
  });

  it('email hard bounce + topic mandatory -> vẫn chặn (L0 không bao giờ bị vượt)', async () => {
    await user('g_bounced', 'g.bounced@company.com');
    await t.db.update(subscriptions).set({ status: 'invalid', suppressedReason: 'hard_bounce' }).where(eq(subscriptions.value, 'g.bounced@company.com'));
    expect(await outcome('g_bounced', 'auth_security')).toMatchObject({ status: 'no_recipient', recipient: { exclusionReason: 'invalid' } });
  });

  it('tắt mọi tin không bắt buộc + topic mandatory -> VẪN gửi', async () => {
    await user('g_mandatory', 'g.mandatory@company.com');
    await v1('PUT', '/users/g_mandatory/preferences', { optedOutOptional: true });
    expect(await outcome('g_mandatory', 'auth_security')).toMatchObject({ status: 'sent' });
    expect(mail.delivered).toHaveLength(1);
  });

  it('user chưa có email -> no_recipient / no_channel', async () => {
    await user('g_noemail');
    expect(await outcome('g_noemail')).toMatchObject({ status: 'no_recipient', recipient: { exclusionReason: 'no_channel', address: '' } });
  });

  it('consent đổi SAU lúc xếp hàng, TRƯỚC lúc gửi -> theo lựa chọn mới nhất', async () => {
    await user('g_late', 'g.late@company.com');
    const res = await send('g_late');
    expect(res.status).toBe(202);
    await v1('PUT', '/users/g_late/preferences', { topics: { order_updates: false } });
    await deliver();
    expect(await status(res.body['id'] as string)).toMatchObject({ status: 'no_recipient', recipient: { exclusionReason: 'opted_out' } });
  });
});

// At-most-once (ADR-0016 D3, implementation_plan.md §7).
describe('chuyển phát at-most-once', () => {
  it('429 rồi thành công -> sent; gọi provider 2 lần nhưng chỉ 1 thư đi', async () => {
    await user('d_retry', 'd.retry@company.com');
    mail.respondWith({ kind: 'retryable', reason: 'HTTP 429', retryAfterMs: 5 });
    const res = await send('d_retry');
    await deliver();
    expect(mail.attempts).toHaveLength(2);
    expect(mail.delivered).toHaveLength(1);
    expect((await status(res.body['id'] as string))['status']).toBe('sent');
  });

  it('hết lượt thử lại -> failed (chắc chắn chưa gửi)', async () => {
    await user('d_exhaust', 'd.exhaust@company.com');
    const retry = { kind: 'retryable' as const, reason: 'HTTP 503', retryAfterMs: 5 };
    mail.respondWith(retry, retry, retry);
    const res = await send('d_exhaust');
    await deliver();
    expect(mail.attempts).toHaveLength(3);
    expect(await status(res.body['id'] as string)).toMatchObject({ status: 'failed', recipient: { status: 'failed', error: expect.stringContaining('retry_exhausted') } });
  });

  it('provider từ chối (4xx) -> failed, không thử lại', async () => {
    await user('d_reject', 'd.reject@company.com');
    mail.respondWith({ kind: 'rejected', reason: 'HTTP 400 ErrorInvalidRecipients' });
    const res = await send('d_reject');
    await deliver();
    expect(mail.attempts).toHaveLength(1);
    expect((await status(res.body['id'] as string))['status']).toBe('failed');
  });

  it('timeout SAU khi gửi -> failed / outcome_unknown; message giao lại KHÔNG gửi lần hai', async () => {
    await user('d_unknown', 'd.unknown@company.com');
    mail.respondWith({ kind: 'unknown', reason: 'timeout after request sent' });
    const res = await send('d_unknown');
    await deliver();
    expect(await status(res.body['id'] as string)).toMatchObject({ status: 'failed', recipient: { error: expect.stringContaining('outcome_unknown') } });

    // Giao lại đúng message đó (Redis at-least-once): worker thấy không còn `queued` -> không gọi provider.
    const entry = (await c.infra.streams.range(STREAMS.NOTIF_QUEUED)).find((e) => e.fields.includes(res.body['id'] as string))!;
    await c.infra.streams.add(STREAMS.NOTIF_QUEUED, entry.fields);
    await deliver();
    expect(mail.attempts).toHaveLength(1);
  });

  // Nhiều worker cùng xử lý MỘT notification (message giao trùng / hai bản worker). Gọi đúng handler của
  // worker 5 lần qua barrier: cả 5 đều đọc thấy `queued` trước khi ai kịp nhận việc — chỉ còn conditional
  // update (`WHERE status = 'queued'`) quyết định ai được gửi.
  it('5 worker cùng xử lý một notification cùng lúc -> đúng 1 lần gọi provider', async () => {
    await user('d_race', 'd.race@company.com');
    const res = await send('d_race');
    while ((await c.infra.outboxRelay.relayOnce()) > 0);
    const entry = (await c.infra.streams.range(STREAMS.NOTIF_QUEUED)).find((e) => e.fields.includes(res.body['id'] as string))!;
    const message = decodeMessage(STREAMS.NOTIF_QUEUED, entry.id, entry.fields, 1);
    const handler = consumerRegistry(application).find((r) => r.group === 'email-sender')!.handler;

    const results = await race(5, () => handler(message));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(mail.attempts).toHaveLength(1);
    expect((await status(res.body['id'] as string))['status']).toBe('sent');
    await deliver(); // dọn message gốc trong stream
    expect(mail.attempts).toHaveLength(1);
  });

  it('job fail-stuck-sending: kẹt ở sending quá hạn -> failed / outcome_unknown; mới kẹt thì chưa đụng', async () => {
    await user('d_stuck', 'd.stuck@company.com');
    const old = (await send('d_stuck')).body['id'] as string;
    const fresh = (await send('d_stuck')).body['id'] as string;
    // Giả lập worker chết sau khi "nhận việc": để ở `sending`, không bao giờ ghi kết quả.
    await t.db.update(notifications).set({ status: 'sending', sendingAt: new Date(Date.now() - 60 * 60_000) }).where(eq(notifications.notificationId, old));
    await t.db.update(notifications).set({ status: 'sending', sendingAt: new Date() }).where(eq(notifications.notificationId, fresh));

    await moduleJobs(application).find((j) => j.name === 'fail-stuck-sending')!.run();
    expect(await status(old)).toMatchObject({ status: 'failed' });
    expect((await status(fresh))['status']).toBe('sending');
    await deliver(); // message của hai notification: không còn `queued` -> không gửi
    expect(mail.attempts).toHaveLength(0);
  });
});

describe('GET /v1/notifications/:id', () => {
  it('notification của app khác -> 404', async () => {
    await user('iso', 'iso@company.com');
    const id = (await send('iso')).body['id'] as string;
    const crm = await provisionApp(api.url, ADMIN_TOKEN, 'crm');
    expect((await v1('GET', `/notifications/${id}`, undefined, crm.apiKey)).status).toBe(404);
    await deliver();
  });
});
