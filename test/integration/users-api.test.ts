import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Container } from '../../src/composition/index.ts';
import { users } from '../../src/modules/directory/infrastructure/db/schema.ts';
import { subscriptions } from '../../src/modules/subscriptions/infrastructure/db/schema.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, provisionApp, signInAdmin, type Json } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/** Token phiên của admin test — gán trong `beforeAll` (`signInAdmin`). Không còn token dùng chung trong env. */
let ADMIN_TOKEN: string;

let t: TestDatabase;
let c: Container;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let shop: { appId: string; apiKey: string };

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 12 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
    { database: t, redis: await createTestRedis() },
  );
  const application = buildApplication(c);
  api = await startApi(c, application);
  ADMIN_TOKEN = (await signInAdmin(application, api.url)).token;
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

// Bề mặt ĐỌC cho vận hành (plan §5, ĐX-0004). Chỉ đọc: không có PUT/POST/DELETE nào ở đây.
describe('/admin/apps/:appId/users — màn Người nhận', () => {
  const admin = (path: string) => http('GET', `/admin${path}`, { token: ADMIN_TOKEN });

  it('liệt kê người nhận của ĐÚNG app, kèm email và tổng số', async () => {
    const other = await provisionApp(api.url, ADMIN_TOKEN, 'other-app');
    await v1('PUT', '/users/list_a', { email: 'list.a@company.com' });
    await v1('PUT', '/users/list_b', { email: 'list.b@company.com' });
    await v1('PUT', '/users/list_c'); // chưa khai email
    await http('PUT', '/v1/users/list_a', { token: other.apiKey, body: { email: 'khac@company.com' } });

    const page = (await admin(`/apps/${shop.appId}/users?limit=200`)).body as unknown as Json;
    const rows = page['rows'] as Json[];
    const mine = rows.filter((r) => String(r['externalId']).startsWith('list_'));
    expect(mine.map((r) => r['externalId']).sort()).toEqual(['list_a', 'list_b', 'list_c']);
    expect(page['total']).toBe(rows.length);

    // Người chưa khai email vẫn hiện, email = null — đó chính là đáp án của "sao anh ấy không nhận được thư".
    expect(mine.find((r) => r['externalId'] === 'list_c')?.['email']).toBeNull();
    expect(mine.find((r) => r['externalId'] === 'list_a')?.['email']).toMatchObject({
      address: 'list.a@company.com',
      status: 'active',
    });

    // App khác có `list_a` riêng, email khác — không lẫn sang nhau.
    const theirs = ((await admin(`/apps/${other.appId}/users`)).body as unknown as Json)['rows'] as Json[];
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ externalId: 'list_a', email: { address: 'khac@company.com' } });
  });

  it('tìm theo external_id và phân trang', async () => {
    const found = ((await admin(`/apps/${shop.appId}/users?q=list_b`)).body as unknown as Json)['rows'] as Json[];
    expect(found.map((r) => r['externalId'])).toEqual(['list_b']);

    const first = (await admin(`/apps/${shop.appId}/users?limit=1&offset=0`)).body as unknown as Json;
    expect((first['rows'] as Json[])).toHaveLength(1);
    expect(first['limit']).toBe(1);
    expect(first['total']).toBeGreaterThan(1);
  });

  it('cài đặt nhận tin của một người: có cả lựa chọn đã bấm và kết quả hiệu lực', async () => {
    // provisionApp không tạo topic — dựng hai topic để thấy rõ hai cột optedIn / effectiveOptIn.
    const makeTopic = async (key: string) => {
      await http('POST', `/admin/apps/${shop.appId}/topics`, { token: ADMIN_TOKEN, body: { key, name: key } });
      await http('POST', `/admin/apps/${shop.appId}/topics/${key}/activate`, { token: ADMIN_TOKEN });
    };
    await makeTopic('pref_seen');
    await makeTopic('pref_untouched');
    await v1('PUT', '/users/pref_view', { email: 'pref.view@company.com' });
    await v1('PUT', '/users/pref_view/preferences', { topics: { pref_seen: false } });

    const body = (await admin(`/apps/${shop.appId}/users/pref_view/preferences`)).body as unknown as Json;
    // `UserEmailSummary` CỐ TÌNH không mang địa chỉ — chỉ trạng thái. Địa chỉ lấy từ route danh sách,
    // không nới DTO này chỉ để phục vụ một màn hình.
    expect(body).toMatchObject({
      externalId: 'pref_view',
      email: { status: 'active', optedOutOptional: false },
    });
    const rows = body['topics'] as Json[];

    // Đã bấm tắt -> cả hai cột đều false.
    expect(rows.find((r) => r['key'] === 'pref_seen')).toMatchObject({ optedIn: false, effectiveOptIn: false });
    // CHƯA bấm gì -> optedIn null, nhưng effectiveOptIn vẫn true theo defaultMode `opt_out`.
    // Hai cột khác nhau: một cái là "người này đã bấm gì", cái kia là "rốt cuộc có nhận không".
    expect(rows.find((r) => r['key'] === 'pref_untouched')).toMatchObject({ optedIn: null, effectiveOptIn: true });
  });

  it('một người theo mã: khớp ĐỦ mã, cùng dạng với dòng danh sách, không lẫn app', async () => {
    const one = await admin(`/apps/${shop.appId}/users/list_a`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ externalId: 'list_a', email: { address: 'list.a@company.com', status: 'active' } });

    // Khác `?q=` của danh sách: một phần mã thì không khớp.
    expect((await admin(`/apps/${shop.appId}/users/list_`)).status).toBe(404);
    // Người chưa khai email vẫn đọc được — email = null.
    expect((await admin(`/apps/${shop.appId}/users/list_c`)).body).toMatchObject({ externalId: 'list_c', email: null });

    const other = await provisionApp(api.url, ADMIN_TOKEN, 'detail-other');
    expect((await admin(`/apps/${other.appId}/users/list_a`)).status).toBe(404);
  });

  it('người không tồn tại -> 404; không có token quản trị -> 401', async () => {
    expect((await admin(`/apps/${shop.appId}/users/khong_co`)).status).toBe(404);
    expect((await admin(`/apps/${shop.appId}/users/khong_co/preferences`)).status).toBe(404);
    expect((await http('GET', `/admin/apps/${shop.appId}/users/list_a`, {})).status).toBe(401);
  });
});
