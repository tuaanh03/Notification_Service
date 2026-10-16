import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApplication,
  consumerRegistry,
  createContainer,
  type Application,
  type Container,
} from '../../src/composition/index.ts';
import { MockEmailProvider } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import type { StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin, type Json } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Màn Soạn thông báo của console: `POST /admin/apps/:appId/notifications` (người cụ thể) và
 * `…/publications` (cả chủ đề) đi đúng đường `/v1`, origin `dashboard`, bấm lại không thành thư thứ hai.
 */
let ADMIN_TOKEN: string;
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let mail: MockEmailProvider;
let worker: StreamConsumer;
let shop: { appId: string; apiKey: string };
let templateId: string;

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
  const r = consumerRegistry(application).find((x) => x.group === 'email-sender')!;
  worker = c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'w1', handler: r.handler, batchSize: 50 });
  await worker.ensureGroup();

  shop = await provisionApp(api.url, ADMIN_TOKEN, 'shop');
  await admin('POST', `/apps/${shop.appId}/topics`, { key: 'order_updates', name: 'Đơn hàng' });
  await admin('POST', `/apps/${shop.appId}/topics/order_updates/activate`);
  for (const id of ['nv_1', 'nv_2', 'nv_3']) await v1('PUT', `/users/${id}`, { email: `${id}@company.com` });

  const created = await admin('POST', `/apps/${shop.appId}/templates`, {
    name: 'Đơn đã giao',
    subject: 'Đơn {{ payload.order }} đã giao',
    html: '<p>Đơn {{ payload.order }} đã giao.</p>',
    text: 'Đơn {{ payload.order }} đã giao.',
    variables: [{ name: 'payload.order', source: 'payload', required: true, sample: 'OS1' }],
  });
  templateId = created.body['id'] as string;
  expect((await admin('POST', `/apps/${shop.appId}/templates/${templateId}/publish`)).status).toBe(200);
});
beforeEach(() => mail.reset());
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

function admin(method: string, path: string, body?: unknown) {
  return http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
}
const v1 = (method: string, path: string, body?: unknown) =>
  http(method, `/v1${path}`, body === undefined ? { token: shop.apiKey } : { token: shop.apiKey, body });
async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  while ((await worker.pollOnce(0)).processed > 0);
}
const codeOf = (body: Json) => (body['issues'] as Json[] | undefined)?.[0]?.['code'] ?? body['code'];

describe('Soạn thông báo — gửi tới người cụ thể', () => {
  it('viết thẳng: người có -> xếp hàng, người không có -> RECIPIENT_NOT_FOUND; thư đi thật, origin dashboard', async () => {
    const res = await admin('POST', `/apps/${shop.appId}/notifications`, {
      topic: 'order_updates',
      externalIds: ['nv_1', 'khong_co', 'nv_2'],
      subject: 'Thử từ web',
      html: '<p>Xin chào</p>',
      requestId: randomUUID(),
    });
    expect(res.status).toBe(202);
    expect(res.body['queued']).toBe(2);
    expect((res.body['results'] as Json[]).map((r) => [r['externalId'], r['code']])).toEqual([
      ['nv_1', null],
      ['khong_co', 'RECIPIENT_NOT_FOUND'],
      ['nv_2', null],
    ]);
    await deliver();
    expect(mail.delivered.map((m) => m.to).sort()).toEqual(['nv_1@company.com', 'nv_2@company.com']);
    const rows = (await admin('GET', `/apps/${shop.appId}/notifications?externalId=nv_1`)).body['rows'] as Json[];
    expect(rows[0]).toMatchObject({ origin: 'dashboard', status: 'sent' });
  });

  it('bấm Gửi lại cùng requestId -> không thêm thư nào', async () => {
    const body = { topic: 'order_updates', externalIds: ['nv_3'], subject: 'Một lần', html: '<p>x</p>', requestId: randomUUID() };
    const first = await admin('POST', `/apps/${shop.appId}/notifications`, body);
    const again = await admin('POST', `/apps/${shop.appId}/notifications`, body);
    expect((again.body['results'] as Json[])[0]!['notificationId']).toBe((first.body['results'] as Json[])[0]!['notificationId']);
    await deliver();
    expect(mail.delivered).toHaveLength(1);
  });

  it('template: xem trước = đúng thư được gửi', async () => {
    const preview = await admin('POST', `/apps/${shop.appId}/templates/${templateId}/render`, { payload: { order: 'OS10527' }, externalId: 'nv_1' });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ subject: 'Đơn OS10527 đã giao', name: 'Đơn đã giao', version: 1 });

    const res = await admin('POST', `/apps/${shop.appId}/notifications`, {
      topic: 'order_updates',
      externalIds: ['nv_1'],
      templateId,
      payload: { order: 'OS10527' },
      requestId: randomUUID(),
    });
    expect(res.body['queued']).toBe(1);
    await deliver();
    expect(mail.delivered[0]).toMatchObject({ subject: preview.body['subject'], html: preview.body['html'] });
  });

  it('lỗi chung -> 422 cả lần gửi: thiếu biến, chủ đề sai, quá 20 người', async () => {
    const send = (extra: Json) =>
      admin('POST', `/apps/${shop.appId}/notifications`, { topic: 'order_updates', externalIds: ['nv_1'], requestId: randomUUID(), ...extra });
    expect(codeOf((await send({ templateId, payload: {} })).body)).toBe('MISSING_VARIABLE');
    expect(codeOf((await send({ topic: 'khong_co', subject: 's', html: 'h' })).body)).toBe('TOPIC_NOT_FOUND');
    expect((await send({ externalIds: Array.from({ length: 21 }, (_, i) => `nv_${i}`), subject: 's', html: 'h' })).status).toBe(422);
    expect(codeOf((await admin('POST', `/apps/${shop.appId}/templates/${templateId}/render`, { payload: {} })).body)).toBe('MISSING_VARIABLE');
  });
});

describe('Soạn thông báo — cả chủ đề', () => {
  it('phát tới mọi người đang theo dõi; bấm lại cùng requestId -> cùng lần phát', async () => {
    const body = { topic: 'order_updates', subject: 'Cho cả chủ đề', html: '<p>Tin chung</p>', requestId: randomUUID() };
    const res = await admin('POST', `/apps/${shop.appId}/publications`, body);
    expect(res.status).toBe(202);
    expect(res.body['recipientCount']).toBe(3);
    expect((await admin('POST', `/apps/${shop.appId}/publications`, body)).body['id']).toBe(res.body['id']);
    await deliver();
    expect(mail.delivered.map((m) => m.to).sort()).toEqual(['nv_1@company.com', 'nv_2@company.com', 'nv_3@company.com']);
  });
});

describe('người nhận đã xoá mềm', () => {
  it('gửi lẻ -> RECIPIENT_NOT_FOUND; phát vào chủ đề không gồm họ; Tổng quan không đếm email của họ; lịch sử cũ giữ mã', async () => {
    await v1('PUT', '/users/nv_del', { email: 'nv_del@company.com' });
    const before = await admin('POST', `/apps/${shop.appId}/notifications`, {
      topic: 'order_updates', externalIds: ['nv_del'], subject: 'Trước khi xoá', html: '<p>x</p>', requestId: randomUUID(),
    });
    await deliver();
    const overviewBefore = (await admin('GET', `/apps/${shop.appId}/overview`)).body['recipients'];

    expect((await admin('DELETE', `/apps/${shop.appId}/users/nv_del`)).status).toBe(204);
    const one = await admin('POST', `/apps/${shop.appId}/notifications`, {
      topic: 'order_updates', externalIds: ['nv_del'], subject: 's', html: 'h', requestId: randomUUID(),
    });
    expect((one.body['results'] as Json[])[0]).toMatchObject({ externalId: 'nv_del', code: 'RECIPIENT_NOT_FOUND' });

    mail.reset();
    const pub = await admin('POST', `/apps/${shop.appId}/publications`, { topic: 'order_updates', subject: 'Chung', html: '<p>x</p>', requestId: randomUUID() });
    expect(pub.body['recipientCount']).toBe(3);
    await deliver();
    expect(mail.delivered.map((m) => m.to)).not.toContain('nv_del@company.com');

    const overviewAfter = (await admin('GET', `/apps/${shop.appId}/overview`)).body['recipients'];
    expect([overviewAfter['total'], overviewAfter['emailActive']]).toEqual([overviewBefore['total'] - 1, overviewBefore['emailActive'] - 1]);

    const id = (before.body['results'] as Json[])[0]!['notificationId'];
    const rows = (await admin('GET', `/apps/${shop.appId}/notifications?limit=200`)).body['rows'] as Json[];
    expect(rows.find((r) => r['id'] === id)).toMatchObject({ externalId: 'nv_del', status: 'sent' });
  });
});

describe('Soạn thông báo — quyền và trạng thái app', () => {
  it('không đăng nhập -> 401; app tạm ngưng -> 422 APP_NOT_ACTIVE', async () => {
    const body = { topic: 'order_updates', externalIds: ['nv_1'], subject: 's', html: 'h', requestId: randomUUID() };
    expect((await http('POST', `/admin/apps/${shop.appId}/notifications`, { body })).status).toBe(401);
    const other = await provisionApp(api.url, ADMIN_TOKEN, 'paused');
    expect((await admin('POST', `/apps/${other.appId}/suspend`, { reason: 'test' })).status).toBe(200);
    expect(codeOf((await admin('POST', `/apps/${other.appId}/notifications`, body)).body)).toBe('APP_NOT_ACTIVE');
  });
});
