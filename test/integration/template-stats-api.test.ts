import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Số liệu template (UX-24): người nhận theo trạng thái, lượt mở (ADR-0031), theo ngày, theo version,
 * danh sách người nhận theo tab, và hai cột ở màn danh sách template. Chỉ những gì EWS đo thật.
 */
const BASE = 'https://ews-api.example.com';
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
    loadEnv({
      DATABASE_URL: t.url,
      REDIS_URL: await testRedisUrl(),
      LOG_LEVEL: 'fatal',
      HOST: '127.0.0.1',
      PORT: '0',
      EMAIL_MAX_PER_MINUTE: '10000',
      WEBHOOK_SIGNING_KEY: 'test-template-stats-key-0123456789abcdef',
    }),
    { database: t, redis: await createTestRedis() },
  );
  mail = new MockEmailProvider({ logger: c.ports.logger });
  application = buildApplication(c, { emailProvider: mail });
  api = await startApi(c, application);
  ADMIN_TOKEN = (await signInAdmin(application, api.url)).token;
  http = httpClient(api.url);
  const r = consumerRegistry(application).find((x) => x.group === 'email-sender')!;
  worker = c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'w1', handler: r.handler, batchSize: 10 });
  await worker.ensureGroup();

  shop = await provisionApp(api.url, ADMIN_TOKEN, 'shop-stats');
  await admin('POST', `/apps/${shop.appId}/topics`, { key: 'orders', name: 'Đơn hàng' });
  await admin('POST', `/apps/${shop.appId}/topics/orders/activate`);
  expect((await admin('PUT', '/system-settings', { values: { 'api.public_base_url': `${BASE}/` } })).status).toBe(200);
  expect((await admin('PUT', `/apps/${shop.appId}/open-tracking`, { enabled: true })).status).toBe(200);
  for (const id of ['u_one', 'u_two', 'u_off', 'u_new']) await v1('PUT', `/users/${id}`, { email: `${id}@company.com` });
  await v1('PUT', '/users/u_off/preferences', { topics: { orders: false } });

  const created = await admin('POST', `/apps/${shop.appId}/templates`, { name: 'Đơn đã giao', ...draft('Đơn {{ payload.order }} đã giao') });
  templateId = created.body['id'] as string;
  expect((await admin('POST', `/apps/${shop.appId}/templates/${templateId}/publish`)).status).toBe(200);

  // Version 1: hai người nhận được thư, một người tắt chủ đề -> bỏ qua.
  for (const id of ['u_one', 'u_two', 'u_off']) await sendTpl(id);
  await deliver();
  // u_one mở thư hai lần.
  const pixel = mail.delivered.find((m) => m.to === 'u_one@company.com')!.html.match(/https:\/\/ews-api\.example\.com(\/t\/o\/[^"]+)"/)![1]!;
  await fetch(`${api.url}${pixel}`);
  await fetch(`${api.url}${pixel}`);

  // Version 2: một người nữa.
  expect((await admin('PUT', `/apps/${shop.appId}/templates/${templateId}/draft`, draft('Bản 2: {{ payload.order }}'))).status).toBe(200);
  expect((await admin('POST', `/apps/${shop.appId}/templates/${templateId}/publish`)).status).toBe(200);
  await sendTpl('u_new');
  await deliver();
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
function draft(subject: string) {
  return {
    subject,
    html: '<p>Đơn {{ payload.order }} đã giao.</p>',
    text: 'Đơn {{ payload.order }} đã giao.',
    variables: [{ name: 'payload.order', source: 'payload', required: true, sample: 'OS1' }],
  };
}
async function sendTpl(externalId: string): Promise<void> {
  const res = await v1('POST', '/notifications', { to: { externalId }, topic: 'orders', templateId, payload: { order: 'OS1' } });
  expect(res.status).toBe(202);
}
async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  while ((await worker.pollOnce(0)).processed > 0);
}
const stats = async (query = '') => (await admin('GET', `/apps/${shop.appId}/templates/${templateId}/stats${query}`)).body;
const recipients = async (query: string) =>
  (await admin('GET', `/apps/${shop.appId}/templates/${templateId}/stats/recipients?${query}`)).body;
const rowsOf = (page: Json) => page['rows'] as Json[];

describe('GET /admin/apps/:appId/templates/:templateId/stats', () => {
  it('cộng mọi version: đã chuyển đi / bỏ qua theo lý do / mở (ước lượng) / tab / 30 ngày', async () => {
    const body = await stats();
    expect(body['window']).toMatchObject({ days: 30 });
    expect(body['version']).toBeNull();
    expect((body['versions'] as Json[]).map((v) => v['version'])).toEqual([2, 1]);
    expect((body['versions'] as Json[]).every((v) => typeof v['publishedAt'] === 'string')).toBe(true);
    expect(body['summary']).toEqual({ total: 4, sent: 3, failed: 0, skipped: 1, pending: 0, skippedByReason: { opted_out: 1 } });
    expect(body['opens']).toEqual({ tracked: 3, opened: 1, total: 2 });
    expect(body['buckets']).toEqual({ sent: 3, opened: 1, unopened: 2, failed: 0, skipped: 1 });

    const series = body['series'] as Json[];
    expect(series).toHaveLength(30);
    expect(series.slice(0, -1).every((d) => d['sent'] === 0 && d['opened'] === 0)).toBe(true);
    expect(series.at(-1)).toMatchObject({ sent: 3, skipped: 1, failed: 0, opened: 1 });
    // Ngày theo giờ Việt Nam, tăng dần, liên tục.
    const dates = series.map((d) => d['date'] as string);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(30);
  });

  it('lọc theo version; version không có -> số 0, không 404', async () => {
    expect((await stats('?version=1'))['summary']).toMatchObject({ total: 3, sent: 2, skipped: 1 });
    const v2 = await stats('?version=2&days=7');
    expect(v2['summary']).toMatchObject({ total: 1, sent: 1 });
    expect(v2['opens']).toEqual({ tracked: 1, opened: 0, total: 0 });
    expect(v2['series']).toHaveLength(7);
    expect((await stats('?version=9'))['summary']).toMatchObject({ total: 0 });
  });

  it('days chỉ nhận 7 / 30 / 90; template của app khác -> 404', async () => {
    expect((await admin('GET', `/apps/${shop.appId}/templates/${templateId}/stats?days=10`)).status).toBe(422);
    const other = await provisionApp(api.url, ADMIN_TOKEN, 'other-stats');
    expect((await admin('GET', `/apps/${other.appId}/templates/${templateId}/stats`)).status).toBe(404);
    expect((await http('GET', `/admin/apps/${shop.appId}/templates/${templateId}/stats`)).status).toBe(401);
  });
});

describe('GET …/stats/recipients', () => {
  it('tab đã mở / chưa mở / bỏ qua: đúng người, kèm mã người nhận, chủ đề, version, lượt mở', async () => {
    const opened = await recipients('bucket=opened');
    expect(opened['total']).toBe(1);
    expect(rowsOf(opened)[0]).toMatchObject({
      address: 'u_one@company.com',
      externalId: 'u_one',
      topicKey: 'orders',
      version: 1,
      status: 'sent',
      openTracked: true,
      openCount: 2,
    });
    expect(rowsOf(await recipients('bucket=unopened')).map((r) => r['externalId']).sort()).toEqual(['u_new', 'u_two']);
    expect(rowsOf(await recipients('bucket=skipped'))[0]).toMatchObject({ externalId: 'u_off', status: 'skipped', exclusionReason: 'opted_out' });
    expect((await recipients('bucket=failed'))['total']).toBe(0);
  });

  it('mặc định tab đã chuyển đi, mới nhất trước; tìm theo email (ký tự % là chữ thường); lọc version', async () => {
    const sent = await recipients('limit=2');
    expect(sent['total']).toBe(3);
    expect(rowsOf(sent)).toHaveLength(2);
    expect(rowsOf(sent)[0]!['externalId']).toBe('u_new');
    expect(rowsOf(await recipients('q=u_two')).map((r) => r['externalId'])).toEqual(['u_two']);
    expect((await recipients('q=%25'))['total']).toBe(0);
    expect(rowsOf(await recipients('version=2')).map((r) => r['externalId'])).toEqual(['u_new']);
    expect((await admin('GET', `/apps/${shop.appId}/templates/${templateId}/stats/recipients?bucket=clicked`)).status).toBe(422);
  });
});

describe('GET /admin/apps/:appId/template-stats', () => {
  it('cộng theo template qua mọi version; app khác không thấy', async () => {
    const body = (await admin('GET', `/apps/${shop.appId}/template-stats`)).body;
    expect(body['days']).toBe(30);
    expect(body['rows']).toEqual([{ templateId, sent: 3, tracked: 3, opened: 1 }]);
    const other = await provisionApp(api.url, ADMIN_TOKEN, 'other-list-stats');
    expect((await admin('GET', `/apps/${other.appId}/template-stats?days=7`)).body).toEqual({ days: 7, rows: [] });
  });
});
