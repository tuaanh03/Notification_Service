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
import { httpClient, provisionApp, signInAdmin, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/** Token phiên của admin test — gán trong `beforeAll` (`signInAdmin`). Không còn token dùng chung trong env. */
let ADMIN_TOKEN: string;

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
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0', EMAIL_MAX_PER_MINUTE: '10000' }),
    { database: t, redis: await createTestRedis() },
  );
  mail = new MockEmailProvider({ logger: c.ports.logger });
  application = buildApplication(c, { emailProvider: mail });
  api = await startApi(c, application);
  ADMIN_TOKEN = (await signInAdmin(application, api.url)).token;
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

// Bề mặt đọc cho vận hành (plan §5): "thư gửi anh A ra sao" trả lời được từ console, không cần log.
describe('GET /admin/apps/:appId/notifications', () => {
  const history = async (query: string, appId = shop.appId) => (await admin('GET', `/apps/${appId}/notifications?${query}`)).body;
  const rows = (page: Json) => page['rows'] as Json[];

  it('ba kết cục hiện đúng: đã gửi / bị loại vì tắt chủ đề / chưa có email — kèm mã người nhận, KHÔNG kèm địa chỉ', async () => {
    await user('h_sent', 'h.sent@company.com');
    await user('h_off', 'h.off@company.com');
    await v1('PUT', '/users/h_off/preferences', { topics: { order_updates: false } });
    await user('h_noemail');
    for (const id of ['h_sent', 'h_off', 'h_noemail']) expect((await send(id, { idempotencyKey: `hist-${id}` })).status).toBe(202);
    await deliver();

    const one = async (externalId: string) => {
      const page = await history(`externalId=${externalId}`);
      expect(page['total']).toBe(1);
      return rows(page)[0]!;
    };
    expect(await one('h_sent')).toMatchObject({
      status: 'sent',
      topic: 'order_updates',
      externalId: 'h_sent',
      idempotencyKey: 'hist-h_sent',
      recipient: { status: 'sent', exclusionReason: null, error: null },
    });
    expect(await one('h_off')).toMatchObject({ status: 'no_recipient', recipient: { status: 'skipped', exclusionReason: 'opted_out' } });
    expect(await one('h_noemail')).toMatchObject({ status: 'no_recipient', recipient: { exclusionReason: 'no_channel' } });
    // Không có địa chỉ, không có nội dung thư — ở bất kỳ dòng nào.
    const all = await history('limit=200');
    for (const row of rows(all)) {
      expect(row['recipient'] === null || !('address' in (row['recipient'] as Json))).toBe(true);
      expect(row).not.toHaveProperty('subject');
    }
  });

  it('lọc theo trạng thái và chủ đề; giá trị không tồn tại -> trang rỗng, không 404', async () => {
    await user('h_filter', 'h.filter@company.com');
    await send('h_filter');
    await send('h_filter', { topic: 'auth_security' });
    await deliver();

    const byTopic = await history('externalId=h_filter&topic=auth_security');
    expect(rows(byTopic).map((r) => r['topic'])).toEqual(['auth_security']);
    expect(rows(await history('status=sent&limit=200')).every((r) => r['status'] === 'sent')).toBe(true);
    expect(await history('externalId=nobody_here')).toMatchObject({ rows: [], total: 0 });
    expect(await history('topic=nope')).toMatchObject({ rows: [], total: 0 });
    expect((await admin('GET', `/apps/${shop.appId}/notifications?status=bogus`)).status).toBe(422);
  });

  it('mới nhất trước; phân trang không lặp dòng', async () => {
    await user('h_page', 'h.page@company.com');
    const sent: string[] = [];
    for (let i = 0; i < 3; i++) sent.push((await send('h_page')).body['id'] as string);
    await deliver();

    const pages = await Promise.all([0, 1, 2].map((offset) => history(`externalId=h_page&limit=1&offset=${offset}`)));
    const got = pages.map((page) => rows(page)[0]!);
    // Ba thư có thể tạo trong cùng một mili giây — so TẬP id, và thứ tự thời gian không tăng.
    expect(new Set(got.map((r) => r['id']))).toEqual(new Set(sent));
    const times = got.map((r) => Date.parse(r['createdAt'] as string));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('app khác không thấy lịch sử của app này', async () => {
    await user('h_iso', 'h.iso@company.com');
    const id = (await send('h_iso')).body['id'] as string;
    await deliver();
    const crm = await provisionApp(api.url, ADMIN_TOKEN, 'crm-history');
    expect(rows(await history('limit=200', crm.appId)).map((r) => r['id'])).not.toContain(id);
    expect(await history('externalId=h_iso', crm.appId)).toMatchObject({ rows: [], total: 0 });
  });

  it('không có token quản trị -> 401', async () => {
    expect((await http('GET', `/admin/apps/${shop.appId}/notifications`)).status).toBe(401);
  });
});

// Để CUỐI file: ca này cố ý để lại một thư `queued` chưa giao — describe nào chạy sau mà gọi
// `deliver()` sẽ gửi nó và lệch số thư của ca đó.
describe('GET /admin/apps/:appId/overview', () => {
  it('đếm đúng trong 24 giờ: theo trạng thái, lý do chặn, theo giờ, hàng chờ, người nhận, chủ đề — chỉ của app này', async () => {
    const dash = await provisionApp(api.url, ADMIN_TOKEN, 'dash-overview');
    const call = (method: string, path: string, body?: unknown) => v1(method, path, body, dash.apiKey);
    await admin('POST', `/apps/${dash.appId}/topics`, { key: 'alerts', name: 'alerts', mandatory: false, defaultMode: 'opt_out' });
    await admin('POST', `/apps/${dash.appId}/topics/alerts/activate`);
    await admin('POST', `/apps/${dash.appId}/topics`, { key: 'later', name: 'later' });

    await call('PUT', '/users/d_ok', { email: 'd.ok@company.com' });
    await call('PUT', '/users/d_off', { email: 'd.off@company.com' });
    await call('PUT', '/users/d_off/preferences', { topics: { alerts: false } });
    await call('PUT', '/users/d_none');
    await call('PUT', '/users/d_unsub', { email: 'd.unsub@company.com' });
    await call('DELETE', '/users/d_unsub/email');

    const sendTo = async (externalId: string) => {
      const res = await call('POST', '/notifications', { to: { externalId }, topic: 'alerts', subject: 'Cảnh báo', html: '<p>x</p>' });
      expect(res.status).toBe(202);
      return res.body['id'] as string;
    };
    const backdate = (id: string, hoursAgo: number) =>
      t.db
        .update(notifications)
        .set({ createdAt: new Date(Date.now() - hoursAgo * 3_600_000) })
        .where(eq(notifications.notificationId, id));

    await sendTo('d_ok'); // sent
    await sendTo('d_off'); // no_recipient / opted_out
    await sendTo('d_none'); // no_recipient / no_channel
    const yesterday = await sendTo('d_ok'); // sent, rồi lùi về 24 giờ trước
    const older = await sendTo('d_ok'); // sent, rồi lùi ra ngoài cả hai cửa sổ
    await deliver();
    mail.respondWith({ kind: 'rejected', reason: 'HTTP 400 ErrorInvalidRecipients' });
    await sendTo('d_ok'); // failed
    await deliver();
    await backdate(yesterday, 30);
    await backdate(older, 50);
    await sendTo('d_ok'); // queued — không giao

    const res = await admin('GET', `/apps/${dash.appId}/overview`);
    expect(res.status).toBe(200);
    const o = res.body;
    expect(o['sends']).toEqual({ total: 5, previousTotal: 1 });
    expect(o['byStatus']).toMatchObject({ sent: 1, failed: 1, no_recipient: 2, queued: 1, sending: 0 });
    expect(o['blocked']).toMatchObject({ opted_out: 1, no_channel: 1, suppressed: 0 });
    expect(o['queue']).toMatchObject({ waiting: 1, oldestCreatedAt: expect.any(String) });
    expect(o['recipients']).toEqual({ total: 4, emailActive: 2, emailUnsubscribed: 1, emailInvalid: 0 });
    expect(o['topics']).toEqual({ total: 2, active: 1 });

    const hourly = o['hourly'] as Json[];
    expect(hourly).toHaveLength(24);
    const hours = hourly.map((h) => Date.parse(h['hour'] as string));
    expect(hours.every((h, i) => i === 0 || h - hours[i - 1]! === 3_600_000)).toBe(true);
    const total = (column: string) => hourly.reduce((n, h) => n + (h[column] as number), 0);
    expect({ sent: total('sent'), failed: total('failed'), blocked: total('blocked'), pending: total('pending') }).toEqual({
      sent: 1,
      failed: 1,
      blocked: 2,
      pending: 1,
    });

    // App khác: toàn số 0 — không lẫn số liệu giữa các app.
    const other = await provisionApp(api.url, ADMIN_TOKEN, 'dash-other');
    const empty = (await admin('GET', `/apps/${other.appId}/overview`)).body;
    expect(empty).toMatchObject({ sends: { total: 0, previousTotal: 0 }, queue: { waiting: 0, oldestCreatedAt: null } });
    expect(empty['recipients']).toMatchObject({ total: 0, emailActive: 0 });
  });

  it('không có token quản trị -> 401; appId sai dạng -> 422', async () => {
    expect((await http('GET', `/admin/apps/${shop.appId}/overview`)).status).toBe(401);
    expect((await admin('GET', '/apps/not-a-uuid/overview')).status).toBe(422);
  });
});

// ADR-0020: app gửi bằng templateId + payload; EWS đổ biến lúc nhận request. App riêng để không lẫn
// vào số liệu của `shop` ở các test lịch sử / tổng quan phía trên.
describe('gửi bằng template', () => {
  let tpl: { appId: string; apiKey: string };
  const tv1 = (method: string, path: string, body?: unknown) => v1(method, path, body, tpl.apiKey);
  const sendTpl = (externalId: string, extra: Record<string, unknown>) =>
    tv1('POST', '/notifications', { to: { externalId }, topic: 'alerts', ...extra });
  const tstatus = async (id: string) => (await tv1('GET', `/notifications/${id}`)).body;
  /** Chỉ thư gửi tới người này — worker dùng chung có thể còn thư tồn của describe khác. */
  const deliveredTo = (externalId: string) => mail.delivered.filter((m) => m.to === `${externalId.replace('_', '.')}@company.com`);
  const issueCodes = (body: Json) => ((body['issues'] ?? []) as Json[]).map((i) => i['code']);

  const draft = (subject: string) => ({
    subject,
    html: '<p>Máy ảo {{ payload.vm_name }} — chủ: {{ payload.owner | default: "chưa rõ" }}</p><a href="{{ payload.url }}">Xem</a>',
    text: 'Máy ảo {{ payload.vm_name }}',
    variables: [
      { name: 'payload.vm_name', source: 'payload', required: true },
      { name: 'payload.owner', source: 'payload', required: false },
      { name: 'payload.url', source: 'payload', required: true },
    ],
  });
  async function publishedTemplate(name: string, subject = '[Cảnh báo] {{ payload.vm_name }}'): Promise<string> {
    const created = await admin('POST', `/apps/${tpl.appId}/templates`, { name, ...draft(subject) });
    const id = created.body['id'] as string;
    expect((await admin('POST', `/apps/${tpl.appId}/templates/${id}/publish`)).status).toBe(200);
    return id;
  }
  const payload = { vm_name: '<ai-gateway>', url: 'https://ews.example.com/vm/1', extra: 'bỏ qua' };

  beforeAll(async () => {
    tpl = await provisionApp(api.url, ADMIN_TOKEN, 'tpl-sender');
    await admin('POST', `/apps/${tpl.appId}/topics`, { key: 'alerts', name: 'Cảnh báo' });
    await admin('POST', `/apps/${tpl.appId}/topics/alerts/activate`);
    for (const id of ['t_ok', 't_err', 't_v2', 't_idem']) {
      await tv1('PUT', `/users/${id}`, { email: `${id.replace('_', '.')}@company.com` });
    }
  });

  it('202 -> worker gửi đúng nội dung ĐÃ đổ biến (html escape, default, khoá thừa bỏ qua); GET có template', async () => {
    const id = await publishedTemplate('Cảnh báo VM');
    const res = await sendTpl('t_ok', { templateId: id, payload });
    expect(res.status).toBe(202);
    expect(res.body['template']).toEqual({ id, version: 1 });

    await deliver();
    expect(deliveredTo('t_ok')).toEqual([
      expect.objectContaining({
        to: 't.ok@company.com',
        subject: '[Cảnh báo] <ai-gateway>',
        html: '<p>Máy ảo &lt;ai-gateway&gt; — chủ: chưa rõ</p><a href="https://ews.example.com/vm/1">Xem</a>',
        text: 'Máy ảo <ai-gateway>',
      }),
    ]);
    expect(await tstatus(res.body['id'] as string)).toMatchObject({ status: 'sent', template: { id, version: 1 } });

    // Lưu template_version_id + payload để tra lại; lịch sử admin có tên template, không có payload.
    const [row] = await t.db.select().from(notifications).where(eq(notifications.notificationId, res.body['id'] as string));
    expect(row?.payload).toEqual(payload);
    const history = (await admin('GET', `/apps/${tpl.appId}/notifications?externalId=t_ok`)).body;
    expect((history['rows'] as Json[])[0]).toMatchObject({ template: { id, name: 'Cảnh báo VM', version: 1 } });
    expect((history['rows'] as Json[])[0]).not.toHaveProperty('payload');
  });

  it('admin xuất bản v2 -> lần gửi sau dùng v2; thư đã nhận trước đó giữ v1', async () => {
    const id = await publishedTemplate('Đổi phiên bản', 'Bản 1: {{ payload.vm_name }}');
    const before = await sendTpl('t_v2', { templateId: id, payload });
    await admin('POST', `/apps/${tpl.appId}/templates/${id}/draft/from/1`);
    await admin('PUT', `/apps/${tpl.appId}/templates/${id}/draft`, draft('Bản 2: {{ payload.vm_name }}'));
    await admin('POST', `/apps/${tpl.appId}/templates/${id}/publish`);
    const after = await sendTpl('t_v2', { templateId: id, payload });

    await deliver();
    expect(deliveredTo('t_v2').map((m) => m.subject).sort()).toEqual(['Bản 1: <ai-gateway>', 'Bản 2: <ai-gateway>']);
    expect((await tstatus(before.body['id'] as string))['template']).toEqual({ id, version: 1 });
    expect((await tstatus(after.body['id'] as string))['template']).toEqual({ id, version: 2 });
  });

  it('lỗi -> 422 với mã rõ ràng, không xếp hàng, không gửi', async () => {
    const id = await publishedTemplate('Kiểm lỗi');
    const code = async (extra: Record<string, unknown>) => issueCodes((await sendTpl('t_err', extra)).body);

    expect(await code({ templateId: id, payload: { url: 'https://a.vn' } })).toEqual(['MISSING_VARIABLE']);
    expect(await code({ templateId: id, payload: { ...payload, vm_name: { a: 1 } } })).toEqual(['INVALID_PAYLOAD_VALUE']);
    expect(await code({ templateId: id, payload: { ...payload, url: 'javascript:alert(1)' } })).toEqual(['LINK_SCHEME_NOT_ALLOWED']);
    expect(await code({ templateId: id, payload, subject: 'x', html: '<p>x</p>' })).toEqual(['CONTENT_AND_TEMPLATE_CONFLICT']);
    expect(await code({ subject: 'x', html: '<p>x</p>', payload })).toEqual(['PAYLOAD_REQUIRES_TEMPLATE']);
    expect(await code({ templateId: '00000000-0000-4000-8000-000000000000', payload })).toEqual(['TEMPLATE_NOT_FOUND']);

    // Template của app khác: như không tồn tại.
    const foreign = (await admin('POST', `/apps/${shop.appId}/templates`, { name: 'Của shop', ...draft('x {{ payload.vm_name }}') })).body;
    await admin('POST', `/apps/${shop.appId}/templates/${foreign['id']}/publish`);
    expect(await code({ templateId: foreign['id'], payload })).toEqual(['TEMPLATE_NOT_FOUND']);

    // Chưa xuất bản / đã lưu trữ.
    const unpublished = (await admin('POST', `/apps/${tpl.appId}/templates`, { name: 'Chưa xuất bản' })).body['id'];
    expect(await code({ templateId: unpublished, payload })).toEqual(['TEMPLATE_NOT_PUBLISHED']);
    await admin('POST', `/apps/${tpl.appId}/templates/${id}/archive`);
    expect(await code({ templateId: id, payload })).toEqual(['TEMPLATE_ARCHIVED']);

    await deliver();
    expect(deliveredTo('t_err')).toHaveLength(0);
  });

  it('trùng idempotencyKey -> 200 bản cũ kèm template; chỉ 1 thư', async () => {
    const id = await publishedTemplate('Idempotency');
    const first = await sendTpl('t_idem', { templateId: id, payload, idempotencyKey: 'tpl-idem-1' });
    const again = await sendTpl('t_idem', { templateId: id, payload, idempotencyKey: 'tpl-idem-1' });
    expect([first.status, again.status]).toEqual([202, 200]);
    expect(again.body).toMatchObject({ id: first.body['id'], template: { id, version: 1 } });
    await deliver();
    expect(deliveredTo('t_idem')).toHaveLength(1);
  });

  it('gửi bằng nội dung viết thẳng vẫn như cũ, template = null', async () => {
    const res = await tv1('POST', '/notifications', {
      to: { externalId: 't_ok' },
      topic: 'alerts',
      subject: 'Viết thẳng',
      html: '<p>x</p>',
    });
    expect(res.status).toBe(202);
    expect(res.body['template']).toBeNull();
    await deliver();
    expect(deliveredTo('t_ok').map((m) => m.subject)).toEqual(['Viết thẳng']);
  });
});
