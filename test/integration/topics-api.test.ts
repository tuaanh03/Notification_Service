import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { buildApplication, createContainer, type Container } from '../../src/composition/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { outbox } from '../../src/shared/db/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, type Json } from './support/http.ts';
import { createTestRedis } from './support/redis.ts';

const ADMIN_TOKEN = 'topics-test-admin-token-'.padEnd(40, 'x');

let t: TestDatabase;
let c: Container;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let shop: { appId: string; apiKey: string };

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 10 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: inject('redisUrl'), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0', ADMIN_TOKEN }),
    { database: t, redis: createTestRedis() },
  );
  api = await startApi(c, buildApplication(c));
  http = httpClient(api.url);
  shop = await provisionApp(api.url, ADMIN_TOKEN, 'shop');

  // Bộ topic mẫu của implementation_plan.md §9 (GĐ 2).
  for (const [key, mandatory, defaultMode] of [
    ['auth_security', true, 'opt_out'],
    ['order_updates', false, 'opt_out'],
    ['newsletter_digest', false, 'opt_in'],
  ] as const) {
    await admin('POST', `/apps/${shop.appId}/topics`, { key, name: key, mandatory, defaultMode });
    await admin('POST', `/apps/${shop.appId}/topics/${key}/activate`);
  }
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

function admin(method: string, path: string, body?: unknown) {
  return http(method, `/admin${path}`, body === undefined ? { token: ADMIN_TOKEN } : { token: ADMIN_TOKEN, body });
}
const v1 = (method: string, path: string, body?: unknown, apiKey = shop.apiKey) =>
  http(method, `/v1${path}`, body === undefined ? { token: apiKey } : { token: apiKey, body });
const topicOf = (prefs: Json, key: string) => (prefs['topics'] as Json[]).find((x) => x['key'] === key);
const preferenceEvents = async () =>
  (await t.db.select().from(outbox).where(eq(outbox.eventType, 'UserTopicPreferenceChanged'))).length;

describe('topic — chỉ admin quản lý (ADR-0016 D6)', () => {
  it('tạo -> 201 draft; trùng key -> 409; app không tồn tại -> 404; key sai định dạng -> 422', async () => {
    const created = await admin('POST', `/apps/${shop.appId}/topics`, { key: 'daily_report', name: 'Báo cáo ngày' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'daily_report', status: 'draft', mandatory: false, defaultMode: 'opt_out' });

    expect((await admin('POST', `/apps/${shop.appId}/topics`, { key: 'daily_report', name: 'x' })).body['code']).toBe(
      'TOPIC_KEY_TAKEN',
    );
    expect((await admin('POST', '/apps/00000000-0000-4000-8000-000000000000/topics', { key: 'abc', name: 'x' })).status).toBe(404);
    expect((await admin('POST', `/apps/${shop.appId}/topics`, { key: 'Has Space', name: 'x' })).status).toBe(422);
  });

  it('/v1/topics chỉ thấy topic active; suspend thì biến mất; sai đường -> 409', async () => {
    await admin('POST', `/apps/${shop.appId}/topics`, { key: 'alerts', name: 'Cảnh báo' });
    const keys = async () => ((await v1('GET', '/topics')).body as unknown as Json[]).map((x) => x['key']);

    expect(await keys()).not.toContain('alerts'); // draft
    expect((await admin('POST', `/apps/${shop.appId}/topics/alerts/suspend`)).body['code']).toBe('INVALID_TRANSITION');
    await admin('POST', `/apps/${shop.appId}/topics/alerts/activate`);
    expect(await keys()).toContain('alerts');
    await admin('POST', `/apps/${shop.appId}/topics/alerts/suspend`);
    expect(await keys()).not.toContain('alerts');
  });

  it('app service KHÔNG tạo được topic (không có route ghi ở /v1)', async () => {
    const res = await v1('POST', '/topics', { key: 'sneaky', name: 'x', mandatory: true });
    expect(res.status).toBe(404);
  });
});

describe('preferences của user', () => {
  it('mặc định: opt_out -> nhận; opt_in -> không nhận; mandatory -> luôn nhận', async () => {
    await v1('PUT', '/users/u_default', { email: 'u.default@company.com' });
    const prefs = (await v1('GET', '/users/u_default/preferences')).body;
    expect(prefs['email']).toMatchObject({ status: 'active', optedOutOptional: false });
    expect(topicOf(prefs, 'order_updates')).toMatchObject({ optedIn: null, effectiveOptIn: true });
    expect(topicOf(prefs, 'newsletter_digest')).toMatchObject({ optedIn: null, effectiveOptIn: false });
    expect(topicOf(prefs, 'auth_security')).toMatchObject({ mandatory: true, effectiveOptIn: true });
  });

  it('tắt / bật topic; gửi lại đúng lựa chọn cũ -> không ghi, không phát event', async () => {
    await v1('PUT', '/users/u_toggle', { email: 'u.toggle@company.com' });
    const off = await v1('PUT', '/users/u_toggle/preferences', { topics: { order_updates: false, newsletter_digest: true } });
    expect(off.status).toBe(200);
    expect(topicOf(off.body, 'order_updates')).toMatchObject({ optedIn: false, effectiveOptIn: false });
    expect(topicOf(off.body, 'newsletter_digest')).toMatchObject({ optedIn: true, effectiveOptIn: true });

    const events = await preferenceEvents();
    await v1('PUT', '/users/u_toggle/preferences', { topics: { order_updates: false } });
    expect(await preferenceEvents()).toBe(events);
  });

  // Chống lạm dụng consent: tin bắt buộc không tắt được — và lỗi thì KHÔNG lưu gì.
  it('tắt topic mandatory -> 422 TOPIC_MANDATORY; các thay đổi hợp lệ cùng request cũng KHÔNG được lưu', async () => {
    await v1('PUT', '/users/u_mandatory', { email: 'u.mandatory@company.com' });
    const res = await v1('PUT', '/users/u_mandatory/preferences', { topics: { order_updates: false, auth_security: false } });
    expect(res.status).toBe(422);
    expect(res.body['issues']).toEqual([expect.objectContaining({ code: 'TOPIC_MANDATORY', path: 'topics.auth_security' })]);
    const prefs = (await v1('GET', '/users/u_mandatory/preferences')).body;
    expect(topicOf(prefs, 'order_updates')).toMatchObject({ optedIn: null });
  });

  it('topic không tồn tại / không active / của app khác -> 422 TOPIC_NOT_FOUND', async () => {
    await v1('PUT', '/users/u_unknown', { email: 'u.unknown@company.com' });
    const res = await v1('PUT', '/users/u_unknown/preferences', { topics: { nope: false, alerts: false } });
    expect(res.status).toBe(422);
    expect((res.body['issues'] as Json[]).map((i) => i['path'])).toEqual(['topics.nope', 'topics.alerts']);
  });

  it('optedOutOptional (L1) lưu trên email; user chưa có email -> 422 EMAIL_NOT_SET', async () => {
    await v1('PUT', '/users/u_l1', { email: 'u.l1@company.com' });
    const res = await v1('PUT', '/users/u_l1/preferences', { optedOutOptional: true });
    expect(res.body['email']).toMatchObject({ optedOutOptional: true });
    // L1 không đổi kết quả L3: effectiveOptIn vẫn là lựa chọn theo topic.
    expect(topicOf(res.body, 'order_updates')).toMatchObject({ effectiveOptIn: true });

    await v1('PUT', '/users/u_no_email');
    const noEmail = await v1('PUT', '/users/u_no_email/preferences', { optedOutOptional: true });
    expect(noEmail.status).toBe(422);
    expect(noEmail.body['issues'][0]).toMatchObject({ code: 'EMAIL_NOT_SET' });
  });

  it('user không tồn tại -> 404; app khác không đọc / ghi được preference của user app này', async () => {
    expect((await v1('GET', '/users/ghost/preferences')).status).toBe(404);
    await v1('PUT', '/users/u_private', { email: 'u.private@company.com' });
    const crm = await provisionApp(api.url, ADMIN_TOKEN, 'crm');
    expect((await v1('GET', '/users/u_private/preferences', undefined, crm.apiKey)).status).toBe(404);
    expect((await v1('PUT', '/users/u_private/preferences', { topics: { order_updates: false } }, crm.apiKey)).status).toBe(404);
  });
});
