import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApplication,
  consumerRegistry,
  createContainer,
  type Application,
  type Container,
} from '../../src/composition/index.ts';
import { MockEmailProvider } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import { notificationRecipients } from '../../src/modules/notifications/infrastructure/db/schema.ts';
import { auditLog } from '../../src/modules/audit/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import type { StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Đếm "đã mở" bằng ảnh theo dõi (ADR-0031): bật cờ app -> worker chèn ảnh có chữ ký -> ứng dụng mail
 * tải ảnh -> `open_count` / `first_opened_at`. URL sai vẫn nhận ảnh y hệt, không ghi gì.
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
      WEBHOOK_SIGNING_KEY: 'test-open-tracking-key-0123456789abcdef',
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

  shop = await provisionApp(api.url, ADMIN_TOKEN, 'shop');
  await admin('POST', `/apps/${shop.appId}/topics`, { key: 'order_updates', name: 'Đơn hàng' });
  await admin('POST', `/apps/${shop.appId}/topics/order_updates/activate`);
  expect((await admin('PUT', '/system-settings', { values: { 'api.public_base_url': `${BASE}/` } })).status).toBe(200);
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
async function sendTo(externalId: string): Promise<string> {
  await v1('PUT', `/users/${externalId}`, { email: `${externalId}@company.com` });
  const res = await v1('POST', '/notifications', {
    to: { externalId },
    topic: 'order_updates',
    subject: 'Đơn đã giao',
    html: '<html><body><p>Đơn của bạn đã giao.</p></body></html>',
  });
  expect(res.status).toBe(202);
  await deliver();
  return res.body['id'] as string;
}
const recipientOf = async (id: string) =>
  (await t.db.select().from(notificationRecipients).where(eq(notificationRecipients.notificationId, id)))[0]!;
/** Ảnh lấy bằng fetch thẳng — client test chỉ đọc JSON. */
const pixel = (path: string) => fetch(`${api.url}${path}`);

describe('Đếm "đã mở" (ADR-0031)', () => {
  it('mặc định tắt: thư đi nguyên HTML, app trả trackOpens=false', async () => {
    expect((await admin('GET', `/apps/${shop.appId}`)).body['trackOpens']).toBe(false);
    expect((await admin('GET', `/apps/${shop.appId}/open-tracking`)).body).toEqual({ enabled: false, ready: true });
    await sendTo('emp_off');
    expect(mail.delivered[0]!.html).toBe('<html><body><p>Đơn của bạn đã giao.</p></body></html>');
  });

  it('bật -> ảnh có chữ ký trước </body>; tải ảnh -> đếm; URL sai vẫn nhận ảnh, không đếm', async () => {
    const on = await admin('PUT', `/apps/${shop.appId}/open-tracking`, { enabled: true });
    expect(on.status).toBe(200);
    expect(on.body['trackOpens']).toBe(true);

    const id = await sendTo('emp_on');
    const html = mail.delivered[0]!.html;
    const match = html.match(/<img src="https:\/\/ews-api\.example\.com(\/t\/o\/([0-9a-f-]{36})\/([A-Za-z0-9_-]{43})\.gif)"[^>]*\/><\/body><\/html>$/);
    expect(match).not.toBeNull();
    const [, path, notificationId, signature] = match!;
    expect(notificationId).toBe(id);
    expect(await recipientOf(id)).toMatchObject({ openCount: 0, firstOpenedAt: null });

    const first = await pixel(path!);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/gif');
    expect(first.headers.get('cache-control')).toContain('no-store');
    const gif = Buffer.from(await first.arrayBuffer());
    const opened = await recipientOf(id);
    expect(opened.openCount).toBe(1);
    expect(opened.firstOpenedAt).not.toBeNull();

    await pixel(path!);
    expect(await recipientOf(id)).toMatchObject({ openCount: 2, firstOpenedAt: opened.firstOpenedAt });
    expect((await admin('GET', `/apps/${shop.appId}/open-tracking`)).body).toEqual({ enabled: true, ready: true });
    // Màn Lịch sử gửi thấy lượt mở; `/v1` thì không (ngoài hợp đồng với đội app).
    const rows = (await admin('GET', `/apps/${shop.appId}/notifications?externalId=emp_on`)).body['rows'];
    expect(rows[0].recipient).toMatchObject({ openCount: 2, firstOpenedAt: opened.firstOpenedAt!.toISOString() });
    expect((await v1('GET', `/notifications/${id}`)).body['recipient']).not.toHaveProperty('openCount');

    // Chữ ký sai / chữ ký của thư khác / không phải .gif -> cùng ảnh, không đếm.
    const forged = `${signature![0] === 'A' ? 'B' : 'A'}${signature!.slice(1)}`;
    const other = await sendTo('emp_other');
    for (const wrong of [
      `/t/o/${id}/${forged}.gif`,
      `/t/o/${other}/${signature}.gif`,
      `/t/o/${id}/${signature}`,
      `/t/o/not-a-uuid/${signature}.gif`,
    ]) {
      const res = await pixel(wrong);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(gif)).toBe(true);
    }
    expect((await recipientOf(id)).openCount).toBe(2);
    expect((await recipientOf(other)).openCount).toBe(0);
  });

  it('tắt lại -> thư sau không còn ảnh; đổi cờ ghi audit, gửi lại cùng giá trị không ghi thêm', async () => {
    await admin('PUT', `/apps/${shop.appId}/open-tracking`, { enabled: true });
    expect((await admin('PUT', `/apps/${shop.appId}/open-tracking`, { enabled: false })).body['trackOpens']).toBe(false);
    await admin('PUT', `/apps/${shop.appId}/open-tracking`, { enabled: false });
    await sendTo('emp_off_again');
    expect(mail.delivered[0]!.html).not.toContain('/t/o/');

    while ((await c.infra.outboxRelay.relayOnce()) > 0);
    const audit = consumerRegistry(application).find((r) => r.group === 'audit-writer')!;
    const auditConsumer = c.infra.createConsumer({ ...audit.options, stream: audit.stream, group: audit.group, consumer: 'a1', handler: audit.handler, batchSize: 50 });
    await auditConsumer.ensureGroup();
    while ((await auditConsumer.pollOnce(0)).processed > 0);
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, 'AppOpenTrackingChanged')).orderBy(asc(auditLog.at));
    // Bật ở test trước + tắt ở test này = 2 lần đổi thật; bật khi đang bật / tắt khi đang tắt không ghi gì.
    expect(rows.map((r) => r.afterData)).toEqual([{ trackOpens: true }, { trackOpens: false }]);
  });

  it('thiếu domain công khai -> ready=false, bật cũng không chèn ảnh', async () => {
    await admin('PUT', `/apps/${shop.appId}/open-tracking`, { enabled: true });
    await admin('PUT', '/system-settings', { values: { 'api.public_base_url': null } });
    try {
      expect((await admin('GET', `/apps/${shop.appId}/open-tracking`)).body).toEqual({ enabled: true, ready: false });
      await sendTo('emp_no_domain');
      expect(mail.delivered[0]!.html).not.toContain('/t/o/');
    } finally {
      await admin('PUT', '/system-settings', { values: { 'api.public_base_url': `${BASE}/` } });
    }
  });

  it('body sai -> 422', async () => {
    expect((await admin('PUT', `/apps/${shop.appId}/open-tracking`, { enabled: 'yes' })).status).toBe(422);
  });
});
