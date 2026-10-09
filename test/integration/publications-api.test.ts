import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApplication,
  consumerRegistry,
  createContainer,
  type Application,
  type Container,
} from '../../src/composition/index.ts';
import { MockEmailProvider } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import { notifications, publications } from '../../src/modules/notifications/infrastructure/db/schema.ts';
import { auditLog } from '../../src/modules/audit/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import type { StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * ADR-0028 — phát tin vào topic: `POST /v1/publications` chốt người đang theo dõi topic, mỗi người một
 * thư con đi đúng đường gửi lẻ (worker `email-sender` thật + MockEmailProvider).
 *
 * MỖI TEST MỘT APP: người nhận của lần phát là mọi user của app, dùng chung app là test này đếm cả user
 * của test kia.
 */

let ADMIN_TOKEN: string;
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let mail: MockEmailProvider;
let worker: StreamConsumer;

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
  const registration = consumerRegistry(application).find((r) => r.group === 'email-sender')!;
  worker = c.infra.createConsumer({
    ...registration.options,
    stream: registration.stream,
    group: registration.group,
    consumer: 'w1',
    handler: registration.handler,
    batchSize: 10,
  });
  await worker.ensureGroup();
});
beforeEach(() => mail.reset());
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const admin = (method: string, path: string, body?: unknown) =>
  http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });

async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  while ((await worker.pollOnce(0)).processed > 0);
}

/** App mới với 3 topic đã kích hoạt + 1 topic nháp. */
async function freshApp(name: string) {
  const app = await provisionApp(api.url, ADMIN_TOKEN, name);
  for (const [key, mandatory, defaultMode] of [
    ['incident', true, 'opt_out'],
    ['maintenance', false, 'opt_out'],
    ['digest', false, 'opt_in'],
  ] as const) {
    await admin('POST', `/apps/${app.appId}/topics`, { key, name: key, mandatory, defaultMode });
    await admin('POST', `/apps/${app.appId}/topics/${key}/activate`);
  }
  await admin('POST', `/apps/${app.appId}/topics`, { key: 'drafted', name: 'drafted' });
  const v1 = (method: string, path: string, body?: unknown, apiKey = app.apiKey) =>
    http(method, `/v1${path}`, body === undefined ? { token: apiKey } : { token: apiKey, body });
  const user = async (externalId: string, email?: string) =>
    expect([200, 201]).toContain((await v1('PUT', `/users/${externalId}`, email ? { email } : undefined)).status);
  const publish = (extra: Record<string, unknown>) =>
    v1('POST', '/publications', {
      topic: 'maintenance',
      subject: 'Bảo trì tối nay',
      html: '<p>Hệ thống bảo trì 22:00.</p>',
      ...extra,
    });
  return { ...app, v1, user, publish };
}

const mailTo = () => mail.delivered.map((m) => m.to).sort();
const issueCode = (body: Json) => ((body['issues'] ?? []) as Json[])[0]?.['code'];

describe('POST /v1/publications', () => {
  it('chỉ người đang theo dõi topic nhận; 202 -> worker gửi -> GET completed với đếm đúng', async () => {
    const app = await freshApp('pub-basic');
    await app.user('a_default', 'a.default@company.com'); // chưa chọn, topic mặc định bật -> nhận
    await app.user('a_on', 'a.on@company.com');
    await app.v1('PUT', '/users/a_on/preferences', { topics: { maintenance: true } });
    await app.user('a_off', 'a.off@company.com'); // tự tắt topic -> không nhận
    await app.v1('PUT', '/users/a_off/preferences', { topics: { maintenance: false } });
    await app.user('a_l1', 'a.l1@company.com'); // tắt mọi tin không bắt buộc -> không nhận
    await app.v1('PUT', '/users/a_l1/preferences', { optedOutOptional: true });
    await app.user('a_unsub', 'a.unsub@company.com'); // tự ngắt email -> không nhận
    await app.v1('DELETE', '/users/a_unsub/email');
    await app.user('a_noemail'); // không có email -> không nhận

    const res = await app.publish({ idempotencyKey: 'maint-2026-10-10' });
    expect(res.status).toBe(202);
    expect(res.headers.get('location')).toBe(`/v1/publications/${res.body['id']}`);
    expect(res.body).toMatchObject({
      topic: 'maintenance',
      template: null,
      idempotencyKey: 'maint-2026-10-10',
      status: 'in_progress',
      recipientCount: 2,
      counts: { pending: 2, sent: 0, failed: 0, skipped: 0 },
    });
    expect((res.body['recipients'] as Json[]).map((r) => r['externalId']).sort()).toEqual(['a_default', 'a_on']);

    await deliver();
    expect(mailTo()).toEqual(['a.default@company.com', 'a.on@company.com']);
    const done = (await app.v1('GET', `/publications/${res.body['id']}`)).body;
    expect(done).toMatchObject({ status: 'completed', counts: { pending: 0, sent: 2, failed: 0, skipped: 0 } });

    // Thư con tra được bằng route gửi lẻ, có publicationId.
    const child = (done['recipients'] as Json[])[0]!;
    expect((await app.v1('GET', `/notifications/${child['notificationId']}`)).body).toMatchObject({
      status: 'sent',
      publicationId: res.body['id'],
    });
  });

  it('topic opt_in: chỉ người đã bật; topic bắt buộc: cả người đã tắt, trừ email đã ngắt', async () => {
    const app = await freshApp('pub-modes');
    await app.user('m_plain', 'm.plain@company.com');
    await app.user('m_digest', 'm.digest@company.com');
    await app.v1('PUT', '/users/m_digest/preferences', { topics: { digest: true } });
    await app.user('m_l1', 'm.l1@company.com');
    await app.v1('PUT', '/users/m_l1/preferences', { optedOutOptional: true });
    await app.user('m_unsub', 'm.unsub@company.com');
    await app.v1('DELETE', '/users/m_unsub/email');

    const digest = await app.publish({ topic: 'digest', idempotencyKey: 'digest-1' });
    expect((digest.body['recipients'] as Json[]).map((r) => r['externalId'])).toEqual(['m_digest']);

    const incident = await app.publish({ topic: 'incident', idempotencyKey: 'incident-1' });
    expect((incident.body['recipients'] as Json[]).map((r) => r['externalId']).sort()).toEqual(['m_digest', 'm_l1', 'm_plain']);

    await deliver();
    expect(mailTo()).toEqual(['m.digest@company.com', 'm.digest@company.com', 'm.l1@company.com', 'm.plain@company.com']);
  });

  it('người nhận tắt topic sau khi phát, trước khi gửi -> worker chặn, đếm vào skipped', async () => {
    const app = await freshApp('pub-late');
    await app.user('l_stay', 'l.stay@company.com');
    await app.user('l_leave', 'l.leave@company.com');
    const res = await app.publish({ idempotencyKey: 'late-1' });
    expect(res.body['recipientCount']).toBe(2);

    await app.v1('PUT', '/users/l_leave/preferences', { topics: { maintenance: false } });
    await deliver();
    expect(mailTo()).toEqual(['l.stay@company.com']);
    expect((await app.v1('GET', `/publications/${res.body['id']}`)).body).toMatchObject({
      status: 'completed',
      counts: { pending: 0, sent: 1, failed: 0, skipped: 1 },
    });
  });

  it('không ai theo dõi -> 202 recipientCount 0, completed, không thư nào', async () => {
    const app = await freshApp('pub-empty');
    await app.user('e_off', 'e.off@company.com');
    const res = await app.publish({ topic: 'digest', idempotencyKey: 'empty-1' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ recipientCount: 0, status: 'completed', recipients: [] });
    await deliver();
    expect(mail.delivered).toHaveLength(0);
  });

  it('trùng idempotencyKey -> 200 lần phát cũ, không thêm thư', async () => {
    const app = await freshApp('pub-idem');
    await app.user('i_one', 'i.one@company.com');
    const first = await app.publish({ idempotencyKey: 'idem-1' });
    const again = await app.publish({ idempotencyKey: 'idem-1', subject: 'Nội dung khác' });
    expect([first.status, again.status]).toEqual([202, 200]);
    expect(again.body['id']).toBe(first.body['id']);
    await deliver();
    expect(mail.delivered).toHaveLength(1);
    expect(mail.delivered[0]!.subject).toBe('Bảo trì tối nay');
  });

  // Ràng buộc "một lần phát mỗi idempotencyKey" là unique index; test chứng minh 5 request cùng lúc
  // không tạo 5 lần phát (bên thua đọc lại bên thắng) và không sinh thư con thừa.
  it('5 request cùng idempotencyKey cùng lúc -> đúng 1 lần phát, đúng N thư con', async () => {
    const app = await freshApp('pub-race');
    await app.user('r_one', 'r.one@company.com');
    await app.user('r_two', 'r.two@company.com');
    const results = await race(5, () => app.publish({ idempotencyKey: 'race-1' }));
    const responses = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(responses.every((r) => r !== null && [200, 202].includes(r.status))).toBe(true);
    expect(responses.filter((r) => r!.status === 202)).toHaveLength(1);
    expect(new Set(responses.map((r) => r!.body['id'])).size).toBe(1);

    const id = responses[0]!.body['id'] as string;
    expect(await t.db.select().from(publications).where(eq(publications.appId, app.appId))).toHaveLength(1);
    expect(await t.db.select().from(notifications).where(eq(notifications.publicationId, id))).toHaveLength(2);
    await deliver();
    expect(mailTo()).toEqual(['r.one@company.com', 'r.two@company.com']);
  });

  it('lỗi input -> 422 đúng mã, không ghi gì', async () => {
    const app = await freshApp('pub-input');
    await app.user('x_one', 'x.one@company.com');
    expect(issueCode((await app.publish({})).body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(issueCode((await app.publish({ topic: 'nope', idempotencyKey: 'k1' })).body)).toBe('TOPIC_NOT_FOUND');
    expect(issueCode((await app.publish({ topic: 'drafted', idempotencyKey: 'k2' })).body)).toBe('TOPIC_NOT_ACTIVE');
    expect(issueCode((await app.publish({ subject: 'a\r\nBcc: x@evil.test', idempotencyKey: 'k3' })).body)).toBe('EMAIL_SUBJECT_INVALID');
    expect(issueCode((await app.publish({ payload: { a: 1 }, idempotencyKey: 'k4' })).body)).toBe('PAYLOAD_REQUIRES_TEMPLATE');
    const extraField = await app.v1('POST', '/publications', { topic: 'maintenance', to: { externalId: 'x_one' }, idempotencyKey: 'k5' });
    expect(extraField.status).toBe(422);
    expect(await t.db.select().from(publications).where(eq(publications.appId, app.appId))).toHaveLength(0);
  });

  it('quá 100 người theo dõi -> 422 PUBLICATION_TOO_LARGE, không ghi gì', async () => {
    const app = await freshApp('pub-large');
    const ids = Array.from({ length: 101 }, (_, i) => `big_${i}`);
    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(ids.slice(i, i + 10).map((id) => app.user(id, `${id.replace('_', '.')}@company.com`)));
    }
    const res = await app.publish({ idempotencyKey: 'large-1' });
    expect(res.status).toBe(422);
    expect(issueCode(res.body)).toBe('PUBLICATION_TOO_LARGE');
    expect(await t.db.select().from(publications).where(eq(publications.appId, app.appId))).toHaveLength(0);

    // Một người tắt topic -> còn 100, vừa trần.
    await app.v1('PUT', '/users/big_0/preferences', { topics: { maintenance: false } });
    expect((await app.publish({ idempotencyKey: 'large-2' })).body['recipientCount']).toBe(100);
    await deliver(); // gửi hết 100 thư con ở đây — để lại thì test sau gửi thay và đếm nhầm
    expect(mail.delivered).toHaveLength(100);
  }, 60_000);

  it('gửi bằng template: đổ biến từng người (user.external_id), lỗi template là 422', async () => {
    const app = await freshApp('pub-template');
    await app.user('p_one', 'p.one@company.com');
    await app.user('p_two', 'p.two@company.com');
    const created = await admin('POST', `/apps/${app.appId}/templates`, {
      name: 'Bảo trì',
      subject: 'Bảo trì {{ payload.window }}',
      html: '<p>Chào {{ user.external_id }}, bảo trì {{ payload.window }}.</p>',
      text: 'Bảo trì {{ payload.window }}',
      variables: [
        { name: 'payload.window', source: 'payload', required: true },
        { name: 'user.external_id', source: 'user', required: true },
      ],
    });
    const templateId = created.body['id'] as string;
    const published = await admin('POST', `/apps/${app.appId}/templates/${templateId}/publish`);
    expect(published.status).toBe(200);

    const missing = await app.publish({ subject: undefined, html: undefined, templateId, payload: {}, idempotencyKey: 'tpl-0' });
    expect(issueCode(missing.body)).toBe('MISSING_VARIABLE');

    const res = await app.publish({ subject: undefined, html: undefined, templateId, payload: { window: '22:00' }, idempotencyKey: 'tpl-1' });
    expect(res.status).toBe(202);
    expect(res.body['template']).toEqual({ id: templateId, version: 1 });
    await deliver();
    expect(mail.delivered.map((m) => m.html).sort()).toEqual([
      '<p>Chào p_one, bảo trì 22:00.</p>',
      '<p>Chào p_two, bảo trì 22:00.</p>',
    ]);
  });

  it('app khác không đọc được lần phát (404); không có API key -> 401', async () => {
    const owner = await freshApp('pub-owner');
    const other = await freshApp('pub-other');
    await owner.user('o_one', 'o.one@company.com');
    const res = await owner.publish({ idempotencyKey: 'own-1' });
    expect((await other.v1('GET', `/publications/${res.body['id']}`)).status).toBe(404);
    expect((await http('POST', '/v1/publications', { body: { topic: 'maintenance' } })).status).toBe(401);
    await deliver();
  });

  it('audit ghi TopicPublished kèm topic, cờ bắt buộc và số người nhận', async () => {
    const app = await freshApp('pub-audit');
    await app.user('u_one', 'u.one@company.com');
    const res = await app.publish({ topic: 'incident', idempotencyKey: 'audit-1' });
    await deliver();
    const auditWorker = consumerRegistry(application).find((r) => r.group === 'audit-writer')!;
    const consumer = c.infra.createConsumer({
      ...auditWorker.options,
      stream: auditWorker.stream,
      group: auditWorker.group,
      consumer: 'a1',
      handler: auditWorker.handler,
    });
    await consumer.ensureGroup();
    while ((await consumer.pollOnce(0)).processed > 0);
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.targetId, res.body['id'] as string));
    expect(rows.map((r) => [r.action, r.targetType, r.actorType, r.source])).toEqual([['TopicPublished', 'Publication', 'app', 'v1_api']]);
    expect(rows[0]!.afterData).toMatchObject({ topic: 'incident', mandatory: true, recipientCount: 1, idempotencyKey: 'audit-1' });
  });
});
