import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Container } from '../../src/composition/index.ts';
import { users } from '../../src/modules/directory/infrastructure/db/schema.ts';
import { subscriptions } from '../../src/modules/subscriptions/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

const ADMIN_TOKEN = 'users-test-admin-token-'.padEnd(40, 'x');

let t: TestDatabase;
let c: Container;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let shop: { appId: string; apiKey: string };

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 12 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0', ADMIN_TOKEN }),
    { database: t, redis: await createTestRedis() },
  );
  api = await startApi(c, buildApplication(c));
  http = httpClient(api.url);
  shop = await provisionApp(api.url, ADMIN_TOKEN, 'shop');
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const v1 = (method: string, path: string, body?: unknown, apiKey = shop.apiKey) =>
  http(method, `/v1${path}`, body === undefined ? { token: apiKey } : { token: apiKey, body });
const subscriptionOf = async (appId: string, userId: string) =>
  (await t.db.select().from(subscriptions).where(and(eq(subscriptions.appId, appId), eq(subscriptions.userId, userId))))[0];

describe('PUT /v1/users/:externalId — đồng bộ user + email', () => {
  it('tạo mới -> 201; email chuẩn hoá (trim, lowercase) nhưng GIỮ +tag (ADR-0008)', async () => {
    const res = await v1('PUT', '/users/emp_01', { email: '  Nhan.Vien+Shop@Company.COM ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      externalId: 'emp_01',
      email: { address: 'nhan.vien+shop@company.com', status: 'active', suppressedReason: null, optedOutOptional: false },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/manage/i); // token quản lý không bao giờ ra API
  });

  it('gọi lại y hệt -> 200, cùng user, không tạo thêm dòng nào', async () => {
    const first = await v1('PUT', '/users/emp_02', { email: 'b@company.com' });
    const again = await v1('PUT', '/users/emp_02', { email: 'b@company.com' });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body['userId']).toBe(first.body['userId']);
  });

  it('không gửi email -> chỉ đồng bộ user, email hiện có giữ nguyên', async () => {
    await v1('PUT', '/users/emp_03', { email: 'c@company.com' });
    const res = await v1('PUT', '/users/emp_03');
    expect(res.status).toBe(200);
    expect(res.body['email']).toMatchObject({ address: 'c@company.com', status: 'active' });
  });

  it('email đã thuộc user khác trong app -> 409 EMAIL_TAKEN, không tạo user mới', async () => {
    await v1('PUT', '/users/owner', { email: 'shared@company.com' });
    const res = await v1('PUT', '/users/intruder', { email: 'SHARED@company.com' });
    expect(res.status).toBe(409);
    expect(res.body['code']).toBe('EMAIL_TAKEN');
    // Cả transaction rollback: user "intruder" cũng không được tạo.
    expect((await v1('GET', '/users/intruder')).status).toBe(404);
  });

  it('email sai định dạng -> 422 EMAIL_INVALID; external_id có khoảng trắng -> 422 INVALID_FIELD', async () => {
    const bad = await v1('PUT', '/users/emp_04', { email: 'not-an-email' });
    expect(bad.status).toBe(422);
    expect(bad.body['issues'][0]).toMatchObject({ code: 'EMAIL_INVALID' });
    const badId = await v1('PUT', '/users/has%20space', { email: 'd@company.com' });
    expect(badId.status).toBe(422);
    expect(badId.body['issues'][0]).toMatchObject({ code: 'INVALID_FIELD', path: 'externalId' });
  });

  it('đổi địa chỉ -> địa chỉ mới, manage_token xoay (link quản lý cũ chết theo)', async () => {
    const created = await v1('PUT', '/users/emp_05', { email: 'old@company.com' });
    const tokenBefore = (await subscriptionOf(shop.appId, created.body['userId'] as string))!.manageToken;
    const changed = await v1('PUT', '/users/emp_05', { email: 'new@company.com' });
    expect(changed.body['email']).toMatchObject({ address: 'new@company.com', status: 'active' });
    expect((await subscriptionOf(shop.appId, created.body['userId'] as string))!.manageToken).not.toBe(tokenBefore);
  });
});

describe('luật trạng thái email (implementation_plan.md §5)', () => {
  it('user tự ngắt (DELETE) -> unsubscribed; app gửi lại đúng email đó -> bật lại', async () => {
    await v1('PUT', '/users/emp_10', { email: 'e10@company.com' });
    const off = await v1('DELETE', '/users/emp_10/email');
    expect(off.body['email']).toMatchObject({ status: 'unsubscribed', suppressedReason: 'user_unsubscribe' });
    expect((await v1('DELETE', '/users/emp_10/email')).status).toBe(200); // gọi lại: no-op

    const on = await v1('PUT', '/users/emp_10', { email: 'e10@company.com' });
    expect(on.body['email']).toMatchObject({ status: 'active', suppressedReason: null });
  });

  it('user đã tự ngắt, app ĐỔI địa chỉ -> vẫn unsubscribed (không bật lại nhận thư trái ý user)', async () => {
    await v1('PUT', '/users/emp_11', { email: 'e11@company.com' });
    await v1('DELETE', '/users/emp_11/email');
    const res = await v1('PUT', '/users/emp_11', { email: 'e11-new@company.com' });
    expect(res.body['email']).toMatchObject({ address: 'e11-new@company.com', status: 'unsubscribed' });
  });

  it('địa chỉ đã hard bounce: gửi lại đúng địa chỉ -> GIỮ invalid; đổi địa chỉ khác -> active', async () => {
    const created = await v1('PUT', '/users/emp_12', { email: 'bounced@company.com' });
    // Giả lập bounce (xử lý bounce tự động nằm ngoài MVP).
    await t.db
      .update(subscriptions)
      .set({ status: 'invalid', suppressedReason: 'hard_bounce' })
      .where(eq(subscriptions.userId, created.body['userId'] as string));

    const same = await v1('PUT', '/users/emp_12', { email: 'bounced@company.com' });
    expect(same.status).toBe(200);
    expect(same.body['email']).toMatchObject({ status: 'invalid', suppressedReason: 'hard_bounce' });
    // Ngắt email trên địa chỉ invalid không được "hạ" nó thành unsubscribed.
    expect((await v1('DELETE', '/users/emp_12/email')).body['email']).toMatchObject({ status: 'invalid' });

    const fixed = await v1('PUT', '/users/emp_12', { email: 'fixed@company.com' });
    expect(fixed.body['email']).toMatchObject({ address: 'fixed@company.com', status: 'active', suppressedReason: null });
  });
});

describe('GET /v1/users/:externalId và cô lập giữa các app', () => {
  it('user không tồn tại -> 404; DELETE email của user không tồn tại -> 404', async () => {
    expect((await v1('GET', '/users/ghost')).status).toBe(404);
    expect((await v1('DELETE', '/users/ghost/email')).status).toBe(404);
  });

  it('app khác không thấy user của app này; cùng external_id / cùng email ở hai app là hai user độc lập', async () => {
    const crm = await provisionApp(api.url, ADMIN_TOKEN, 'crm');
    await v1('PUT', '/users/same_id', { email: 'same@company.com' });

    expect((await v1('GET', '/users/same_id', undefined, crm.apiKey)).status).toBe(404);
    const inCrm = await v1('PUT', '/users/same_id', { email: 'same@company.com' }, crm.apiKey);
    expect(inCrm.status).toBe(201);
    expect(inCrm.body['userId']).not.toBe((await v1('GET', '/users/same_id')).body['userId']);
  });
});

describe('đồng thời', () => {
  it('5 request tạo cùng một user song song -> đúng 1 user, 1 email; request nào cũng thành công', async () => {
    const results = await race(5, () => v1('PUT', '/users/racer', { email: 'racer@company.com' }));
    const responses = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(responses.every((r) => r !== null && (r.status === 201 || r.status === 200))).toBe(true);
    expect(responses.filter((r) => r?.status === 201)).toHaveLength(1);
    expect(new Set(responses.map((r) => (r!.body as Json)['userId'])).size).toBe(1);

    const rows = await t.db.select().from(users).where(and(eq(users.appId, shop.appId), eq(users.externalId, 'racer')));
    expect(rows).toHaveLength(1);
    const subs = await t.db.select().from(subscriptions).where(eq(subscriptions.userId, rows[0]!.userId));
    expect(subs).toHaveLength(1);
  });

  it('5 request đặt 5 email KHÁC nhau cho cùng user song song -> vẫn chỉ 1 subscription (khoá dòng user)', async () => {
    const created = await v1('PUT', '/users/switcher');
    await race(5, (i) => v1('PUT', '/users/switcher', { email: `switch-${i}@company.com` }));
    const subs = await t.db.select().from(subscriptions).where(eq(subscriptions.userId, created.body['userId'] as string));
    expect(subs).toHaveLength(1);
  });
});
