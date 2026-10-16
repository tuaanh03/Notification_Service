import { createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import {
  buildApplication,
  consumerRegistry,
  createContainer,
  moduleJobs,
  type Application,
  type Container,
} from '../../src/composition/index.ts';
import { MockEmailProvider } from '../../src/modules/delivery/infrastructure/adapters/index.ts';
import type { WebhookCallResult, WebhookTransport } from '../../src/modules/webhooks/application/index.ts';
import { webhookDeliveries } from '../../src/modules/webhooks/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import type { StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * ADR-0029 — outgoing webhook end-to-end: gửi thư -> worker gửi -> event -> consumer `webhook-dispatcher`
 * ghi lượt gọi -> job `deliver-webhooks` gọi ra URL (transport GIẢ ghi lại request, không gọi mạng).
 */

/** Ghi lại mọi lần gọi; `respond` kịch bản hoá câu trả lời của app. */
class RecordingTransport implements WebhookTransport {
  calls: { url: string; body: string; headers: Readonly<Record<string, string>> }[] = [];
  respond: (url: string) => WebhookCallResult = () => ({ kind: 'ok', statusCode: 200 });

  async post(request: { url: string; body: string; headers: Readonly<Record<string, string>> }): Promise<WebhookCallResult> {
    this.calls.push(request);
    return this.respond(request.url);
  }

  reset(): void {
    this.calls = [];
    this.respond = () => ({ kind: 'ok', statusCode: 200 });
  }
}

let ADMIN_TOKEN: string;
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let mail: MockEmailProvider;
const transport = new RecordingTransport();
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
      WEBHOOK_SIGNING_KEY: 'test-webhook-signing-key-0123456789abcdef',
    }),
    { database: t, redis: await createTestRedis() },
  );
  mail = new MockEmailProvider({ logger: c.ports.logger });
  application = buildApplication(c, { emailProvider: mail, webhookTransport: transport });
  api = await startApi(c, application);
  ADMIN_TOKEN = (await signInAdmin(application, api.url)).token;
  http = httpClient(api.url);
  workers = ['email-sender', 'webhook-dispatcher'].map((group) => {
    const r = consumerRegistry(application).find((x) => x.group === group)!;
    return c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'w1', handler: r.handler, batchSize: 10 });
  });
  for (const w of workers) await w.ensureGroup();
});
beforeEach(() => {
  mail.reset();
  transport.reset();
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const admin = (method: string, path: string, body?: unknown) =>
  http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
const issueCode = (body: Json) => ((body['issues'] ?? []) as Json[])[0]?.['code'];

/** relay outbox -> stream, worker gửi thư + dispatcher ghi lượt gọi, rồi job gọi webhook. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    while ((await c.infra.outboxRelay.relayOnce()) > 0);
    for (const w of workers) while ((await w.pollOnce(0)).processed > 0);
  }
  await moduleJobs(application).find((j) => j.name === 'deliver-webhooks')!.run();
}

/** Lượt `pending` của URL -> đến hạn ngay (thay cho chờ 1 phút / 5 phút… thật). */
async function makeDue(endpointId: string): Promise<void> {
  await t.db
    .update(webhookDeliveries)
    .set({ nextAttemptAt: sql`NOW(3) - INTERVAL 1 SECOND` })
    .where(eq(webhookDeliveries.endpointId, endpointId));
}

/** App mới + topic `alerts` đã kích hoạt + một người nhận. */
async function freshApp(name: string) {
  const app = await provisionApp(api.url, ADMIN_TOKEN, name);
  await admin('POST', `/apps/${app.appId}/topics`, { key: 'alerts', name: 'alerts', defaultMode: 'opt_out' });
  await admin('POST', `/apps/${app.appId}/topics/alerts/activate`);
  const v1 = (method: string, path: string, body?: unknown) =>
    http(method, `/v1${path}`, body === undefined ? { token: app.apiKey } : { token: app.apiKey, body });
  await v1('PUT', '/users/nv01', { email: 'nv01@company.com' });
  const send = (externalId = 'nv01') =>
    v1('POST', '/notifications', { to: { externalId }, topic: 'alerts', subject: 'Cảnh báo', html: '<p>x</p>' });
  const addHook = (body: Record<string, unknown> = {}) =>
    admin('POST', `/apps/${app.appId}/webhooks`, { url: `https://${name}.example.com/hook`, events: ['notification.sent'], ...body });
  return { ...app, v1, send, addHook };
}

const verify = (call: { body: string; headers: Readonly<Record<string, string>> }, secret: string) => {
  const { t: ts, v1 } = Object.fromEntries(call.headers['x-ews-signature']!.split(',').map((p) => p.split('='))) as Record<string, string>;
  return createHmac('sha256', secret).update(`${ts}.${call.body}`).digest('hex') === v1;
};

describe('quản lý URL webhook', () => {
  it('thêm -> 201 kèm secret MỘT lần; danh sách không có secret', async () => {
    const app = await freshApp('wh-create');
    const res = await app.addHook({ events: ['notification.failed', 'notification.sent'] });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body['secret']).toMatch(/^whsec_/);
    expect(res.body['endpoint']).toMatchObject({
      url: 'https://wh-create.example.com/hook',
      events: ['notification.sent', 'notification.failed'],
      status: 'active',
    });

    const list = (await admin('GET', `/apps/${app.appId}/webhooks`)).body;
    expect(list['configured']).toBe(true);
    expect(JSON.stringify(list)).not.toContain('whsec_');
    expect(list['endpoints'] as Json[]).toHaveLength(1);
  });

  it('URL / sự kiện sai -> 422 đúng mã', async () => {
    const app = await freshApp('wh-invalid');
    expect(issueCode((await app.addHook({ url: 'http://a.example.com/h' })).body)).toBe('WEBHOOK_URL_INVALID');
    expect(issueCode((await app.addHook({ url: 'https://10.36.67.52:4002/h' })).body)).toBe('WEBHOOK_URL_INVALID');
    expect(issueCode((await app.addHook({ url: 'https://localhost/h' })).body)).toBe('WEBHOOK_URL_INVALID');
    expect(issueCode((await app.addHook({ events: [] })).body)).toBe('WEBHOOK_EVENTS_REQUIRED');
    expect((await app.addHook({ events: ['ping'] })).status).toBe(422);
  });

  // "Tối đa N URL mỗi app" (cài đặt hệ thống, ở đây hạ xuống 2) = unique (app_id, slot); bên thua đọc lại và thử chỗ còn lại.
  it('5 lệnh thêm cùng lúc, trần 2 -> đúng 2 URL, còn lại 422 WEBHOOK_LIMIT_REACHED', async () => {
    expect((await admin('PUT', '/system-settings', { values: { 'webhooks.max_endpoints_per_app': 2 } })).status).toBe(200);
    onTestFinished(async () => {
      await admin('PUT', '/system-settings', { values: { 'webhooks.max_endpoints_per_app': null } });
    });
    const app = await freshApp('wh-race');
    const results = await race(5, (i) => app.addHook({ url: `https://wh-race-${i}.example.com/h` }));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 422)).toHaveLength(3);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 422) expect(issueCode(r.value.body)).toBe('WEBHOOK_LIMIT_REACHED');
    }
    expect(((await admin('GET', `/apps/${app.appId}/webhooks`)).body['endpoints'] as Json[]).map((e) => e['id'])).toHaveLength(2);

    // Xoá một URL -> chỗ được trả lại.
    const first = ((await admin('GET', `/apps/${app.appId}/webhooks`)).body['endpoints'] as Json[])[0]!;
    expect((await admin('DELETE', `/apps/${app.appId}/webhooks/${first['id']}`)).status).toBe(204);
    expect((await app.addHook()).status).toBe(201);
  });

  it('URL của app khác -> 404', async () => {
    const owner = await freshApp('wh-owner');
    const other = await freshApp('wh-other');
    const id = ((await owner.addHook()).body['endpoint'] as Json)['id'];
    expect((await admin('PATCH', `/apps/${other.appId}/webhooks/${id}`, { status: 'disabled' })).status).toBe(404);
    expect((await admin('GET', `/apps/${other.appId}/webhooks/${id}/deliveries`)).status).toBe(404);
  });
});

describe('gọi webhook khi thư có kết quả', () => {
  it('thư gửi xong -> app nhận đúng một lần gọi, đã ký, body không có email / nội dung', async () => {
    const app = await freshApp('wh-e2e');
    const hook = (await app.addHook()).body;
    const sent = await app.send();
    await settle();

    expect(mail.delivered).toHaveLength(1);
    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0]!;
    expect(call.url).toBe('https://wh-e2e.example.com/hook');
    expect(call.headers).toMatchObject({ 'content-type': 'application/json', 'x-ews-event': 'notification.sent' });
    expect(verify(call, hook['secret'] as string)).toBe(true);
    const body = JSON.parse(call.body) as Json;
    expect(body).toMatchObject({
      type: 'notification.sent',
      data: {
        notificationId: sent.body['id'],
        publicationId: null,
        externalId: 'nv01',
        topic: 'alerts',
        status: 'sent',
        exclusionReason: null,
        error: null,
      },
    });
    expect(call.body).not.toContain('nv01@company.com');
    expect(call.body).not.toContain('Cảnh báo');

    const log = (await admin('GET', `/apps/${app.appId}/webhooks/${(hook['endpoint'] as Json)['id']}/deliveries`)).body as unknown as Json[];
    expect(log).toEqual([
      expect.objectContaining({ eventType: 'notification.sent', status: 'delivered', attempts: 1, lastStatusCode: 200, eventId: body['id'] }),
    ]);

    // Chạy lại cả vòng: không gọi thêm.
    await settle();
    expect(transport.calls).toHaveLength(1);
  });

  it('chỉ gọi sự kiện đã đăng ký: bị chặn (no_recipient) mà chỉ đăng ký sent -> không gọi', async () => {
    const app = await freshApp('wh-filter');
    await app.addHook();
    await app.v1('PUT', '/users/nv01/preferences', { topics: { alerts: false } });
    await app.send();
    await settle();
    expect(mail.delivered).toHaveLength(0);
    expect(transport.calls).toHaveLength(0);
  });

  it('thư thuộc lần phát có publicationId; no_recipient có exclusionReason', async () => {
    const app = await freshApp('wh-publication');
    await app.addHook({ events: ['notification.sent', 'notification.no_recipient'] });
    await app.v1('PUT', '/users/nv02', { email: 'nv02@company.com' });
    const pub = await app.v1('POST', '/publications', { topic: 'alerts', subject: 'Phát', html: '<p>x</p>', idempotencyKey: 'p1' });
    expect(pub.body['recipientCount']).toBe(2);
    // nv02 tắt topic sau lúc phát -> worker chặn -> no_recipient.
    await app.v1('PUT', '/users/nv02/preferences', { topics: { alerts: false } });
    await settle();

    const bodies = transport.calls.map((call) => JSON.parse(call.body) as { type: string; data: Json });
    expect(bodies.map((b) => [b.type, b.data['externalId'], b.data['publicationId'], b.data['exclusionReason']]).sort()).toEqual([
      ['notification.no_recipient', 'nv02', pub.body['id'], 'opted_out'],
      ['notification.sent', 'nv01', pub.body['id'], null],
    ]);
  });

  it('notification.opened: chỉ lần mở ĐẦU TIÊN, kèm openedAt; ba sự kiện cũ không có openedAt (ADR-0031)', async () => {
    const app = await freshApp('wh-opened');
    await app.addHook({ events: ['notification.sent', 'notification.opened'] });
    await admin('PUT', `/apps/${app.appId}/open-tracking`, { enabled: true });
    await admin('PUT', '/system-settings', { values: { 'api.public_base_url': 'https://ews-api.example.com' } });
    try {
      await app.send();
      await settle();
      const sent = JSON.parse(transport.calls[0]!.body) as { type: string; data: Json };
      expect(sent.type).toBe('notification.sent');
      expect(sent.data).not.toHaveProperty('openedAt');

      const path = mail.delivered[0]!.html.match(/https:\/\/ews-api\.example\.com(\/t\/o\/[^"]+)"/)![1]!;
      transport.reset();
      await fetch(`${api.url}${path}`);
      await fetch(`${api.url}${path}`);
      await settle();
      const opened = transport.calls.map((call) => JSON.parse(call.body) as { type: string; data: Json });
      expect(opened.map((b) => b.type)).toEqual(['notification.opened']);
      expect(opened[0]!.data).toMatchObject({ externalId: 'nv01', topic: 'alerts', status: 'sent' });
      expect(Date.parse(opened[0]!.data['openedAt'] as string)).toBeGreaterThan(0);
    } finally {
      await admin('PUT', '/system-settings', { values: { 'api.public_base_url': null } });
    }
  });

  it('app lỗi -> gọi lại theo lịch; hết 6 lần -> failed; cùng một eventId mọi lần', async () => {
    const app = await freshApp('wh-retry');
    const endpointId = ((await app.addHook()).body['endpoint'] as Json)['id'] as string;
    transport.respond = () => ({ kind: 'failed', statusCode: 503, error: 'http_503' });
    await app.send();
    await settle();

    const log = async () => ((await admin('GET', `/apps/${app.appId}/webhooks/${endpointId}/deliveries`)).body as unknown as Json[])[0]!;
    const first = await log();
    expect(first).toMatchObject({ status: 'pending', attempts: 1, lastStatusCode: 503, lastError: 'http_503' });
    // Lần sau sau ~1 phút — chưa tới hạn thì job không gọi.
    const waitMs = Date.parse(first['nextAttemptAt'] as string) - Date.now();
    expect(waitMs).toBeGreaterThan(50_000);
    await settle();
    expect(transport.calls).toHaveLength(1);

    for (let attempt = 2; attempt <= 6; attempt++) {
      await makeDue(endpointId);
      await settle();
      expect(transport.calls).toHaveLength(attempt);
    }
    expect(await log()).toMatchObject({ status: 'failed', attempts: 6, nextAttemptAt: null });
    expect(new Set(transport.calls.map((call) => (JSON.parse(call.body) as Json)['id'])).size).toBe(1);
    expect(new Set(transport.calls.map((call) => call.body)).size).toBe(1);

    await makeDue(endpointId);
    await settle();
    expect(transport.calls).toHaveLength(6);
  });

  it('tắt URL -> lượt đang chờ thành failed, thư sau không gọi; bật lại -> gọi tiếp', async () => {
    const app = await freshApp('wh-disable');
    const endpointId = ((await app.addHook()).body['endpoint'] as Json)['id'] as string;
    transport.respond = () => ({ kind: 'failed', statusCode: null, error: 'timeout' });
    await app.send();
    await settle();

    const disabled = await admin('PATCH', `/apps/${app.appId}/webhooks/${endpointId}`, { status: 'disabled' });
    expect(disabled.body).toMatchObject({ status: 'disabled' });
    const log = (await admin('GET', `/apps/${app.appId}/webhooks/${endpointId}/deliveries`)).body as unknown as Json[];
    expect(log[0]).toMatchObject({ status: 'failed', lastError: 'endpoint_disabled' });

    transport.reset();
    await app.send();
    await settle();
    expect(transport.calls).toHaveLength(0);

    await admin('PATCH', `/apps/${app.appId}/webhooks/${endpointId}`, { status: 'active' });
    await app.send();
    await settle();
    expect(transport.calls).toHaveLength(1);
  });

  it('đổi secret -> lần gọi sau ký bằng secret mới, secret cũ không còn khớp', async () => {
    const app = await freshApp('wh-rotate');
    const created = (await app.addHook()).body;
    const endpointId = (created['endpoint'] as Json)['id'];
    const rotated = await admin('POST', `/apps/${app.appId}/webhooks/${endpointId}/rotate-secret`);
    expect(rotated.status).toBe(200);
    expect(rotated.body['secret']).not.toBe(created['secret']);

    await app.send();
    await settle();
    expect(verify(transport.calls[0]!, rotated.body['secret'] as string)).toBe(true);
    expect(verify(transport.calls[0]!, created['secret'] as string)).toBe(false);
  });

  it('gửi thử: gọi ngay sự kiện ping, trả kết quả, ghi vào nhật ký, không gọi lại khi lỗi', async () => {
    const app = await freshApp('wh-ping');
    const created = (await app.addHook()).body;
    const endpointId = (created['endpoint'] as Json)['id'];

    const ok = await admin('POST', `/apps/${app.appId}/webhooks/${endpointId}/test`);
    expect(ok.body).toMatchObject({ eventType: 'ping', status: 'delivered', attempts: 1, lastStatusCode: 200 });
    expect(transport.calls[0]!.headers['x-ews-event']).toBe('ping');
    expect(verify(transport.calls[0]!, created['secret'] as string)).toBe(true);

    transport.respond = () => ({ kind: 'failed', statusCode: 404, error: 'http_404' });
    const bad = await admin('POST', `/apps/${app.appId}/webhooks/${endpointId}/test`);
    expect(bad.body).toMatchObject({ status: 'failed', attempts: 1, lastStatusCode: 404, nextAttemptAt: null });
    await settle();
    expect(transport.calls).toHaveLength(2);
    expect((await admin('GET', `/apps/${app.appId}/webhooks/${endpointId}/deliveries`)).body as unknown as Json[]).toHaveLength(2);
  });

  it('xoá URL -> mất cả nhật ký, thư sau không gọi', async () => {
    const app = await freshApp('wh-delete');
    const endpointId = ((await app.addHook()).body['endpoint'] as Json)['id'] as string;
    await app.send();
    await settle();
    expect(transport.calls).toHaveLength(1);

    expect((await admin('DELETE', `/apps/${app.appId}/webhooks/${endpointId}`)).status).toBe(204);
    expect(await t.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId))).toHaveLength(0);
    await app.send();
    await settle();
    expect(transport.calls).toHaveLength(1);
  });
});

describe('thiếu WEBHOOK_SIGNING_KEY', () => {
  it('danh sách báo configured: false; thêm URL -> 503 WEBHOOK_NOT_CONFIGURED', async () => {
    const bare = createContainer(
      loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
      { database: t, redis: await createTestRedis() },
    );
    const bareApp = buildApplication(bare, { emailProvider: mail, webhookTransport: transport });
    const bareApi = await startApi(bare, bareApp);
    try {
      const app = await freshApp('wh-unconfigured');
      const call = (method: string, path: string, body?: unknown) =>
        httpClient(bareApi.url)(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
      expect((await call('GET', `/apps/${app.appId}/webhooks`)).body).toEqual({ configured: false, endpoints: [] });
      const res = await call('POST', `/apps/${app.appId}/webhooks`, { url: 'https://a.example.com/h', events: ['notification.sent'] });
      expect([res.status, res.body['code']]).toEqual([503, 'WEBHOOK_NOT_CONFIGURED']);
      await expect(moduleJobs(bareApp).find((j) => j.name === 'deliver-webhooks')!.run()).resolves.toBeUndefined();
    } finally {
      await bareApi.stop();
    }
  });
});
