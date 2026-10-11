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
import { incomingHooks } from '../../src/modules/incoming/infrastructure/db/schema.ts';
import { publications } from '../../src/modules/notifications/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import type { StreamConsumer } from '../../src/shared/streams/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * ADR-0030 — incoming webhook end-to-end: công cụ ngoài POST JSON của nó vào `/hooks/:token` -> EWS rút
 * biến theo ánh xạ -> `PublishToTopic` -> worker `email-sender` thật gửi (MockEmailProvider).
 * Hai body mẫu đúng như đề xuất: Gatus (kênh `custom`) và JSON tự build có mảng.
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
  t = await createTestDatabase({ poolSize: 14 });
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
  worker = c.infra.createConsumer({ ...r.options, stream: r.stream, group: r.group, consumer: 'w1', handler: r.handler, batchSize: 10 });
  await worker.ensureGroup();
});
beforeEach(() => mail.reset());
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const admin = (method: string, path: string, body?: unknown) =>
  http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
const codeOf = (body: Json) => ((body['issues'] ?? []) as Json[])[0]?.['code'] ?? body['code'];

async function deliver(): Promise<void> {
  while ((await c.infra.outboxRelay.relayOnce()) > 0);
  while ((await worker.pollOnce(0)).processed > 0);
}

/** Gọi hook như công cụ ngoài: không API key, chỉ token trong URL. */
async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${api.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

/** App mới: topic `incident`, 2 người theo dõi, template "Sự cố" đã xuất bản. */
async function freshApp(name: string) {
  const app = await provisionApp(api.url, ADMIN_TOKEN, name);
  const topic = (await admin('POST', `/apps/${app.appId}/topics`, { key: 'incident', name: 'Sự cố', defaultMode: 'opt_out' })).body;
  await admin('POST', `/apps/${app.appId}/topics/incident/activate`);
  for (const id of ['nv01', 'nv02']) {
    await http('PUT', `/v1/users/${id}`, { token: app.apiKey, body: { email: `${id}@company.com` } });
  }
  const template = (
    await admin('POST', `/apps/${app.appId}/templates`, {
      name: 'Sự cố',
      subject: '[{{ payload.state | default: "ALERT" }}] {{ payload.service }}',
      html: '<p>{{ payload.service }} ({{ payload.group | default: "-" }}): {{ payload.detail }} — {{ payload.source | default: "?" }} · {{ payload.tags | default: "" }}</p>',
      text: '{{ payload.service }}: {{ payload.detail }}',
      variables: [
        { name: 'payload.service', source: 'payload', required: true },
        { name: 'payload.state', source: 'payload', required: false },
        { name: 'payload.group', source: 'payload', required: false },
        { name: 'payload.detail', source: 'payload', required: true },
        { name: 'payload.source', source: 'payload', required: false },
        { name: 'payload.tags', source: 'payload', required: false },
      ],
    })
  ).body;
  const pub = await admin('POST', `/apps/${app.appId}/templates/${template['id']}/publish`);
  expect(pub.status).toBe(200);
  return { ...app, topicId: topic['id'] as string, templateId: template['id'] as string };
}

/** Ánh xạ cho body kênh `custom` của Gatus (mục 6 của đề xuất). */
const gatusConfig = (app: { topicId: string; templateId: string }, extra: Record<string, unknown> = {}) => ({
  name: 'Gatus — sự cố',
  topicId: app.topicId,
  templateId: app.templateId,
  mappings: [
    { variable: 'payload.service', kind: 'path', path: 'endpoint.name' },
    { variable: 'payload.group', kind: 'path', path: 'endpoint.group', defaultValue: 'chung' },
    { variable: 'payload.state', kind: 'path', path: 'alert.state' },
    { variable: 'payload.detail', kind: 'path', path: 'alert.description', defaultValue: 'Không có mô tả' },
    { variable: 'payload.source', kind: 'fixed', value: 'Gatus' },
  ],
  condition: { path: 'alert.state', values: ['TRIGGERED'] },
  ...extra,
});
const gatusBody = (service: string, state = 'TRIGGERED') => ({
  endpoint: { name: service, group: '', url: `https://${service}.company.com/health` },
  alert: { state, description: 'HTTP 503 trong 3 lần liên tiếp' },
  errors: '',
});

async function createHook(appId: string, config: unknown) {
  const res = await admin('POST', `/apps/${appId}/incoming-webhooks`, config);
  expect(res.status).toBe(201);
  return res.body as { hook: Json; token: string; path: string; url: string | null };
}

describe('POST /hooks/:token', () => {
  it('Gatus: rút biến theo ánh xạ, 202 phát cho người theo dõi topic, worker gửi đúng nội dung', async () => {
    const app = await freshApp('in-gatus');
    const issued = await createHook(app.appId, gatusConfig(app));
    expect(issued.token).toMatch(/^ewshk_[A-Za-z0-9_-]{43}$/);
    expect(issued.path).toBe(`/hooks/${issued.token}`);
    expect(issued.url).toBeNull(); // chưa khai domain API công khai
    expect(issued.hook['warnings']).toEqual([]);

    const res = await call(issued.path, gatusBody('payment-api'));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'published', recipientCount: 2 });

    await deliver();
    expect(mail.delivered.map((m) => m.to).sort()).toEqual(['nv01@company.com', 'nv02@company.com']);
    expect(mail.delivered[0]).toMatchObject({
      subject: '[TRIGGERED] payment-api',
      html: '<p>payment-api (chung): HTTP 503 trong 3 lần liên tiếp — Gatus · </p>',
    });

    // Lần phát ghi người tạo là hook — tra được nguồn.
    const [row] = await t.db.select().from(publications).where(eq(publications.publicationId, res.body['publicationId'] as string));
    expect(row?.createdBy).toBe(issued.hook['id']);

    const log = (await admin('GET', `/apps/${app.appId}/incoming-webhooks/${issued.hook['id']}/calls`)).body as unknown as Json[];
    expect(log[0]).toMatchObject({ outcome: 'published', httpStatus: 202, recipientCount: 2, publicationId: res.body['publicationId'] });
  });

  it('JSON tự build có mảng: [-1], ["khoá.có.chấm"], mảng nối, trường cùng tên; khoá chống trùng theo đường dẫn', async () => {
    const app = await freshApp('in-team');
    const issued = await createHook(app.appId, {
      name: 'Team alert',
      topicId: app.topicId,
      templateId: app.templateId,
      mappings: [
        { variable: 'payload.service', kind: 'path', path: 'alerts[0].labels["app.kubernetes.io/name"]' },
        { variable: 'payload.detail', kind: 'path', path: 'alerts[-1].summary' },
      ],
      dedupePath: 'id',
      condition: { path: 'severity', values: ['critical', 'high'] },
    });
    const body = {
      id: 'inc-2026-1011-07',
      severity: 'critical',
      state: 'FIRING',
      alerts: [
        { labels: { 'app.kubernetes.io/name': 'payment-api' }, summary: 'CPU > 95%' },
        { labels: { 'app.kubernetes.io/name': 'payment-api' }, summary: 'Latency > 2s' },
      ],
      tags: ['prod', 'hanoi'],
    };
    const first = await call(issued.path, body);
    expect(first.status).toBe(202);
    await deliver();
    expect(mail.delivered[0]).toMatchObject({
      subject: '[FIRING] payment-api',
      html: '<p>payment-api (-): Latency &gt; 2s — ? · prod, hanoi</p>', // HTML được escape
    });

    // Cùng `id`, nội dung khác -> vẫn là trùng: 200 kèm lần phát cũ, không gửi thêm.
    mail.reset();
    const again = await call(issued.path, { ...body, alerts: [body.alerts[0]] });
    expect(again).toMatchObject({ status: 200, body: { status: 'duplicate', publicationId: first.body['publicationId'] } });
    await deliver();
    expect(mail.delivered).toHaveLength(0);
  });

  it('không có khoá: cùng body trong khung chống trùng chỉ phát một lần; header Idempotency-Key thắng', async () => {
    const app = await freshApp('in-dedupe');
    const issued = await createHook(app.appId, gatusConfig(app));
    const a = await call(issued.path, gatusBody('svc-a'));
    const b = await call(issued.path, { errors: '', alert: gatusBody('svc-a').alert, endpoint: gatusBody('svc-a').endpoint });
    expect([a.status, b.status]).toEqual([202, 200]);
    expect(b.body['publicationId']).toBe(a.body['publicationId']);

    const h1 = await call(issued.path, gatusBody('svc-a'), { 'idempotency-key': 'k-1' });
    const h2 = await call(issued.path, gatusBody('svc-b'), { 'idempotency-key': 'k-1' });
    expect([h1.status, h2.status]).toEqual([202, 200]);
  });

  it('điều kiện không thoả -> 200 skipped, không phát; thiếu biến bắt buộc -> 422, nhật ký ghi lại', async () => {
    const app = await freshApp('in-skip');
    const issued = await createHook(app.appId, {
      ...gatusConfig(app),
      mappings: gatusConfig(app).mappings.map((m) => (m.variable === 'payload.detail' ? { ...m, defaultValue: null } : m)),
    });
    const skipped = await call(issued.path, gatusBody('svc', 'RESOLVED'));
    expect(skipped).toMatchObject({ status: 200, body: { status: 'skipped', reason: 'condition_not_met' } });

    const missing = await call(issued.path, { endpoint: { name: 'svc' }, alert: { state: 'TRIGGERED' } });
    expect([missing.status, codeOf(missing.body)]).toEqual([422, 'MISSING_VARIABLE']);

    const invalid = await call(issued.path, { endpoint: { name: { deep: 1 } }, alert: { state: 'TRIGGERED', description: 'x' } });
    expect([invalid.status, codeOf(invalid.body)]).toEqual([422, 'INVALID_PAYLOAD_VALUE']);

    expect((await call(issued.path, ['not', 'an', 'object'])).status).toBe(422);
    expect(await t.db.select().from(publications).where(eq(publications.appId, app.appId))).toHaveLength(0);

    const log = (await admin('GET', `/apps/${app.appId}/incoming-webhooks/${issued.hook['id']}/calls`)).body as unknown as Json[];
    expect(log.map((l) => [l['outcome'], l['httpStatus'], l['errorCode']])).toEqual([
      ['rejected', 422, 'INCOMING_BODY_INVALID'],
      ['rejected', 422, 'INVALID_PAYLOAD_VALUE'],
      ['rejected', 422, 'MISSING_VARIABLE'],
      ['skipped', 200, 'condition_not_met'],
    ]);
  });

  it('token sai / hook tắt -> 404 như nhau; đổi URL -> token cũ 404, token mới chạy; IP lạ -> 403', async () => {
    const app = await freshApp('in-token');
    const issued = await createHook(app.appId, gatusConfig(app));
    const id = issued.hook['id'] as string;
    expect((await call('/hooks/ewshk_' + 'x'.repeat(43), gatusBody('s'))).status).toBe(404);
    expect((await call('/hooks/not-a-token', gatusBody('s'))).status).toBe(404);

    await admin('PATCH', `/apps/${app.appId}/incoming-webhooks/${id}`, { status: 'disabled' });
    expect((await call(issued.path, gatusBody('s'))).status).toBe(404);
    await admin('PATCH', `/apps/${app.appId}/incoming-webhooks/${id}`, { status: 'active' });

    const rotated = (await admin('POST', `/apps/${app.appId}/incoming-webhooks/${id}/rotate-token`)).body;
    expect(rotated['token']).not.toBe(issued.token);
    expect((await call(issued.path, gatusBody('s1'))).status).toBe(404);
    expect((await call(rotated['path'] as string, gatusBody('s1'))).status).toBe(202);

    await admin('POST', `/apps/${app.appId}/network-rules`, { kind: 'ip', value: '10.9.9.9' });
    const blocked = await call(rotated['path'] as string, gatusBody('s2'));
    expect([blocked.status, blocked.body['code']]).toEqual([403, 'IP_NOT_ALLOWED']);
  });

  it('vượt giới hạn mỗi phút (Cài đặt hệ thống) -> 429; đổi cài đặt có hiệu lực ngay', async () => {
    const app = await freshApp('in-rate');
    const issued = await createHook(app.appId, gatusConfig(app));
    expect((await admin('PUT', '/system-settings', { values: { 'incoming.max_publications_per_minute': 1 } })).status).toBe(200);
    try {
      expect((await call(issued.path, gatusBody('r1'))).status).toBe(202);
      const limited = await call(issued.path, gatusBody('r2'));
      expect([limited.status, limited.body['code']]).toEqual([429, 'INCOMING_HOOK_RATE_LIMITED']);
      // Bị bỏ qua vì điều kiện thì không tính vào giới hạn.
      expect((await call(issued.path, gatusBody('r3', 'RESOLVED'))).status).toBe(200);
    } finally {
      await admin('PUT', '/system-settings', { values: { 'incoming.max_publications_per_minute': null } });
    }
  });
});

describe('quản lý hook', () => {
  it('cấu hình sai -> 422 báo hết lỗi; topic / template của app khác -> 422', async () => {
    const app = await freshApp('in-invalid');
    const other = await freshApp('in-invalid-2');
    const bad = await admin('POST', `/apps/${app.appId}/incoming-webhooks`, {
      ...gatusConfig(app),
      mappings: [
        { variable: 'service', kind: 'fixed', value: 'x' },
        { variable: 'payload.a', kind: 'path', path: 'a..b' },
      ],
    });
    expect(bad.status).toBe(422);
    expect((bad.body['issues'] as Json[]).map((i) => i['code']).sort()).toEqual(['INCOMING_MAPPING_INVALID', 'WEBHOOK_PATH_INVALID']);
    expect(codeOf((await admin('POST', `/apps/${app.appId}/incoming-webhooks`, gatusConfig({ ...app, topicId: other.topicId }))).body)).toBe(
      'TOPIC_NOT_FOUND',
    );
    expect(
      codeOf((await admin('POST', `/apps/${app.appId}/incoming-webhooks`, gatusConfig({ ...app, templateId: other.templateId }))).body),
    ).toBe('TEMPLATE_NOT_FOUND');
  });

  // "Tối đa 10 hook mỗi app" = unique (app_id, slot); bên thua đọc lại và thử chỗ khác.
  it('12 lệnh thêm cùng lúc -> đúng 10 hook, 2 lệnh 422 INCOMING_HOOK_LIMIT_REACHED; danh sách không có token', async () => {
    const app = await freshApp('in-race');
    const results = await race(12, (i) => admin('POST', `/apps/${app.appId}/incoming-webhooks`, { ...gatusConfig(app), name: `h${i}` }));
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(2);
    expect(await t.db.select().from(incomingHooks).where(eq(incomingHooks.appId, app.appId))).toHaveLength(10);
    const list = (await admin('GET', `/apps/${app.appId}/incoming-webhooks`)).body;
    expect(JSON.stringify(list)).not.toMatch(/ewshk_[A-Za-z0-9_-]{43}/);
    expect((list['hooks'] as Json[])[0]!['tokenHint']).toMatch(/^ewshk_.{4}….{4}$/);
  });

  it('cảnh báo: biến bắt buộc chưa ánh xạ, ánh xạ biến template không khai; domain công khai -> URL đầy đủ', async () => {
    const app = await freshApp('in-warn');
    await admin('PUT', '/system-settings', { values: { 'api.public_base_url': 'https://ews-api.example.com/' } });
    try {
      const issued = await createHook(app.appId, {
        name: 'Ít ánh xạ',
        topicId: app.topicId,
        templateId: app.templateId,
        mappings: [{ variable: 'payload.ghost', kind: 'fixed', value: 'x' }],
      });
      expect(issued.url).toBe(`https://ews-api.example.com/hooks/${issued.token}`);
      expect(issued.hook['warnings']).toEqual(
        expect.arrayContaining([
          { code: 'REQUIRED_VARIABLE_UNMAPPED', variable: 'payload.service' },
          { code: 'REQUIRED_VARIABLE_UNMAPPED', variable: 'payload.detail' },
          { code: 'MAPPING_NOT_IN_TEMPLATE', variable: 'payload.ghost' },
        ]),
      );
    } finally {
      await admin('PUT', '/system-settings', { values: { 'api.public_base_url': null } });
    }
  });

  it('xem trước bằng JSON mẫu: biến rút ra, mặc định, thiếu, điều kiện, thư đã đổ biến — không gửi gì', async () => {
    const app = await freshApp('in-preview');
    await deliver(); // gửi hết thư tồn của test trước — sau đây đếm thư của riêng test này
    mail.reset();
    const res = await admin('POST', `/apps/${app.appId}/incoming-webhooks/preview`, {
      config: gatusConfig(app),
      sample: gatusBody('payment-api'),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      conditionMet: true,
      dedupe: { source: 'body_hash', windowMinutes: 10 },
      rendered: { subject: '[TRIGGERED] payment-api' },
      renderIssues: [],
    });
    const vars = res.body['variables'] as Json[];
    expect(vars.find((v) => v['variable'] === 'payload.group')).toMatchObject({ value: 'chung', usedDefault: true });
    expect(vars.find((v) => v['variable'] === 'payload.source')).toMatchObject({ source: 'fixed', value: 'Gatus' });

    const missing = await admin('POST', `/apps/${app.appId}/incoming-webhooks/preview`, {
      config: { ...gatusConfig(app), mappings: [] },
      sample: { other: 1 },
    });
    expect(missing.body['rendered']).toBeNull();
    expect((missing.body['renderIssues'] as Json[]).map((i) => [i['code'], i['path']])).toEqual([
      ['MISSING_VARIABLE', 'payload.service'],
      ['MISSING_VARIABLE', 'payload.detail'],
    ]);
    await deliver();
    expect(mail.delivered).toHaveLength(0);
    expect(await t.db.select().from(publications).where(eq(publications.appId, app.appId))).toHaveLength(0);
  });
});

describe('Cài đặt hệ thống', () => {
  it('GET đủ danh mục + mặc định; PUT ngoài khoảng / khoá lạ -> 422, không ghi gì', async () => {
    const list = (await admin('GET', '/system-settings')).body['settings'] as Json[];
    expect(list.map((s) => s['key'])).toEqual(['incoming.dedupe_window_minutes', 'incoming.max_publications_per_minute', 'api.public_base_url']);
    expect(list[0]).toMatchObject({ value: 10, default: 10, min: 1, max: 1440, customized: false });

    const bad = await admin('PUT', '/system-settings', { values: { 'incoming.dedupe_window_minutes': 30, 'incoming.max_publications_per_minute': 0 } });
    expect([bad.status, codeOf(bad.body)]).toEqual([422, 'SETTING_OUT_OF_RANGE']);
    expect(codeOf((await admin('PUT', '/system-settings', { values: { nope: 1 } })).body)).toBe('SETTING_UNKNOWN');
    expect(((await admin('GET', '/system-settings')).body['settings'] as Json[])[0]).toMatchObject({ value: 10, customized: false });
  });
});
