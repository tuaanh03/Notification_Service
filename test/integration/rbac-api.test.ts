import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { AccountId, AppId, ConflictError, OrgId, type AppRole, type OrgRole } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, signInAdmin, TEST_PASSWORD, type Json } from './support/http.ts';
import { race, rejected } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * RBAC đa tenant qua HTTP thật (ADR-0022). Một account, hai org:
 *   org A: app A1, A2 — owner, member + App Viewer A1, member + App Admin A1
 *   org B: app B1     — người ngoài A là thành viên B
 */
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;

const CTX = { actor: { id: 'test', type: 'admin' as const }, source: 'system' as const };
let SUPER: string;
const superEmail = 'super@test.local';
let accountId: string;
const org = { A: '', B: '' };
const app = { A1: '', A2: '', B1: '' };
const token = { owner: '', viewer: '', appAdmin: '', outsider: '' };

function as(who: string) {
  return (method: string, path: string, body?: unknown) =>
    http(method, `/admin${path}`, body === undefined ? { token: who } : { token: who, body });
}

async function must(res: Promise<{ status: number; body: Json }>, status: number): Promise<Json> {
  const r = await res;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Tạo người dùng thường (vai `user`) rồi đăng nhập thật, trả token phiên. */
async function userWith(email: string, memberships: [orgId: string, role: OrgRole][], appRoles: [appId: string, role: AppRole][] = []) {
  await application.adminOps.createAdmin.execute(
    { accountId: AccountId.parse(accountId), email, password: TEST_PASSWORD, role: 'user' },
    CTX,
  );
  for (const [orgId, role] of memberships) await application.adminOps.setOrgMember.execute({ orgId: OrgId.parse(orgId), email, role }, CTX);
  for (const [appId, role] of appRoles) await application.adminOps.grantAppRole.execute({ appId: AppId.parse(appId), email, role }, CTX);
  const body = await must(http('POST', '/auth/login', { body: { email, password: TEST_PASSWORD } }), 200);
  return body['token'] as string;
}

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 10 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
    { database: t, redis: await createTestRedis() },
  );
  application = buildApplication(c);
  api = await startApi(c, application);
  http = httpClient(api.url);

  const signedIn = await signInAdmin(application, api.url, { email: superEmail });
  SUPER = signedIn.token;
  accountId = signedIn.accountId;
  const root = as(SUPER);
  for (const name of ['A', 'B'] as const) {
    org[name] = (await must(root('POST', `/accounts/${accountId}/organizations`, { name: `Org ${name}` }), 201))['id'] as string;
  }
  for (const [name, orgName] of [['A1', 'A'], ['A2', 'A'], ['B1', 'B']] as const) {
    const slug = `rbac-${name.toLowerCase()}`;
    app[name] = (await must(root('POST', '/apps', { orgId: org[orgName], slug, name: slug, namespace: slug }), 201))['id'] as string;
  }

  token.owner = await userWith('owner@test.local', [[org.A, 'owner']]);
  token.viewer = await userWith('viewer@test.local', [[org.A, 'member']], [[app.A1, 'app_viewer']]);
  token.appAdmin = await userWith('app-admin@test.local', [[org.A, 'member']], [[app.A1, 'app_admin']]);
  token.outsider = await userWith('outsider@test.local', [[org.B, 'owner']]);
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const ids = (body: Json) => (body as unknown as Json[]).map((a) => a['id']);

describe('người ngoài org: 404 — y như đối tượng không tồn tại', () => {
  it('app, danh sách app, org và audit của org khác đều 404', async () => {
    const outsider = as(token.outsider);
    for (const path of [`/apps/${app.A1}`, `/apps?orgId=${org.A}`, `/organizations/${org.A}`, `/apps/${app.A1}/topics`, `/audit?targetType=App&targetId=${app.A1}`]) {
      const res = await outsider('GET', path);
      expect([path, res.status, res.body['code']]).toEqual([path, 404, 'NOT_FOUND']);
    }
    // Id sai định dạng cũng 404, không 422: không dò được gì từ thông báo lỗi.
    expect((await outsider('GET', '/apps/khong-phai-uuid')).status).toBe(404);
  });

  it('ghi vào app của org khác cũng 404', async () => {
    const res = await as(token.outsider)('POST', `/apps/${app.A1}/topics`, { key: 'leak', name: 'Leak' });
    expect(res.status).toBe(404);
  });
});

describe('GET /admin/me — vai của chính mình', () => {
  it('Owner: chỉ org của mình, kèm vai; không có vai app trực tiếp', async () => {
    const me = await must(as(token.owner)('GET', '/me'), 200);
    expect(me).toEqual({ isSuperAdmin: false, orgs: [{ id: org.A, name: 'Org A', role: 'owner' }], appRoles: {} });
  });

  it('App Viewer: org + vai app trực tiếp', async () => {
    const me = await must(as(token.viewer)('GET', '/me'), 200);
    expect(me['orgs']).toEqual([{ id: org.A, name: 'Org A', role: 'member' }]);
    expect(me['appRoles']).toEqual({ [app.A1]: 'app_viewer' });
  });

  it('Super Admin: mọi org; role là vai thành viên thật, null ở org không thuộc về', async () => {
    const me = await must(as(SUPER)('GET', '/me'), 200);
    expect(me['isSuperAdmin']).toBe(true);
    expect((me['orgs'] as Json[]).map((o) => [o['name'], o['role']])).toEqual([['Org A', null], ['Org B', null]]);

    // Super Admin vào thêm org B -> console app thấy org B, khu Quản trị EWS vẫn thấy mọi org.
    await application.adminOps.setOrgMember.execute({ orgId: OrgId.parse(org.B), email: superEmail, role: 'member' }, CTX);
    const after = await must(as(SUPER)('GET', '/me'), 200);
    expect((after['orgs'] as Json[]).map((o) => [o['name'], o['role']])).toEqual([['Org A', null], ['Org B', 'member']]);
  });
});

describe('Member + App Viewer', () => {
  it('danh sách app chỉ có app được cấp vai', async () => {
    expect(ids(await must(as(token.viewer)('GET', `/apps?orgId=${org.A}`), 200))).toEqual([app.A1]);
  });

  it('xem được app của mình; app khác cùng org -> 403 (đã là thành viên, không cần giấu)', async () => {
    const viewer = as(token.viewer);
    expect((await viewer('GET', `/apps/${app.A1}`)).status).toBe(200);
    expect((await viewer('GET', `/apps/${app.A1}/topics`)).status).toBe(200);
    const other = await viewer('GET', `/apps/${app.A2}`);
    expect([other.status, other.body['code']]).toEqual([403, 'FORBIDDEN']);
  });

  it('không cấu hình được: tạo topic, cấp khoá API, tạo app -> 403', async () => {
    const viewer = as(token.viewer);
    expect((await viewer('POST', `/apps/${app.A1}/topics`, { key: 'x_topic', name: 'X' })).status).toBe(403);
    expect((await viewer('POST', `/apps/${app.A1}/secrets`)).status).toBe(403);
    expect((await viewer('POST', '/apps', { orgId: org.A, slug: 'nope', name: 'n', namespace: 'nope' })).status).toBe(403);
  });
});

describe('Member + App Admin', () => {
  it('cấu hình app của mình: tạo topic thường -> 201', async () => {
    expect((await as(token.appAdmin)('POST', `/apps/${app.A1}/topics`, { key: 'by_app_admin', name: 'OK' })).status).toBe(201);
  });

  it('topic BẮT BUỘC, duyệt / tạm ngưng app: chỉ Super Admin -> 403', async () => {
    const appAdmin = as(token.appAdmin);
    expect((await appAdmin('POST', `/apps/${app.A1}/topics`, { key: 'must_read', name: 'M', mandatory: true })).status).toBe(403);
    expect((await appAdmin('POST', `/apps/${app.A1}/approve`, { grantedChannels: ['email'] })).status).toBe(403);
    expect((await appAdmin('POST', `/apps/${app.A1}/suspend`)).status).toBe(403);
  });

  it('cấp khoá API cho app của mình — được, không chờ ai duyệt (ADR-0023)', async () => {
    expect((await as(token.appAdmin)('POST', `/apps/${app.A1}/secrets`)).status).toBe(201);
  });
});

describe('Owner', () => {
  it('ngầm là App Admin trên MỌI app của org: thấy cả A1, A2; tạo app trong org mình', async () => {
    const owner = as(token.owner);
    expect(ids(await must(owner('GET', `/apps?orgId=${org.A}`), 200)).sort()).toEqual([app.A1, app.A2].sort());
    expect((await owner('POST', `/apps/${app.A2}/topics`, { key: 'by_owner', name: 'OK' })).status).toBe(201);
    expect((await owner('POST', '/apps', { orgId: org.A, slug: 'owner-made', name: 'o', namespace: 'owner-made' })).status).toBe(201);
  });

  it('không tạo app ở org khác (404), không làm việc cấp hệ thống (403)', async () => {
    const owner = as(token.owner);
    expect((await owner('POST', '/apps', { orgId: org.B, slug: 'sneak', name: 's', namespace: 'sneak' })).status).toBe(404);
    expect((await owner('POST', '/accounts', { name: 'X' })).status).toBe(403);
    expect((await owner('GET', `/audit?targetType=Admin&targetId=${accountId}`)).status).toBe(403);
    expect((await owner('GET', `/audit?targetType=App&targetId=${app.A1}`)).status).toBe(200);
  });
});

describe('đổi quyền có hiệu lực ngay ở request kế tiếp (không cache)', () => {
  it('Member được nâng lên Org Admin -> thấy app A2 ngay', async () => {
    const viewer = as(token.viewer);
    expect((await viewer('GET', `/apps/${app.A2}`)).status).toBe(403);
    await application.adminOps.setOrgMember.execute({ orgId: OrgId.parse(org.A), email: 'viewer@test.local', role: 'org_admin' }, CTX);
    expect((await viewer('GET', `/apps/${app.A2}`)).status).toBe(200);
  });
});

describe('ràng buộc ép ở command (ADR-0009)', () => {
  const setRole = (email: string, role: OrgRole, orgId = org.A) =>
    application.adminOps.setOrgMember.execute({ orgId: OrgId.parse(orgId), email, role }, CTX);

  it('hạ vai owner CUỐI CÙNG -> 409 LAST_OWNER', async () => {
    await expect(setRole('outsider@test.local', 'member', org.B)).rejects.toMatchObject({ code: 'LAST_OWNER' });
  });

  it('hai owner cùng hạ vai nhau song song -> đúng MỘT lệnh lọt, org vẫn còn owner', async () => {
    await application.adminOps.createAdmin.execute(
      { accountId: AccountId.parse(accountId), email: 'owner2@test.local', password: null, role: 'user' },
      CTX,
    );
    await setRole('owner2@test.local', 'owner');
    const results = await race(2, (i) => setRole(i === 0 ? 'owner@test.local' : 'owner2@test.local', 'member'));
    const errors = rejected(results);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ConflictError);
    expect((errors[0] as ConflictError).code).toBe('LAST_OWNER');
  });

  it('cấp vai app cho người KHÔNG thuộc org của app -> 409 NOT_ORG_MEMBER', async () => {
    await expect(
      application.adminOps.grantAppRole.execute({ appId: AppId.parse(app.A1), email: 'outsider@test.local', role: 'app_viewer' }, CTX),
    ).rejects.toMatchObject({ code: 'NOT_ORG_MEMBER' });
  });

  it('thêm người khác account vào org -> từ chối (chống cấp quyền chéo account)', async () => {
    const other = await application.adminOps.createAccount.execute({ name: 'Khác' }, CTX);
    await application.adminOps.createAdmin.execute(
      { accountId: AccountId.parse(other.id), email: 'stranger@test.local', password: null, role: 'user' },
      CTX,
    );
    await expect(setRole('stranger@test.local', 'member')).rejects.toMatchObject({ code: 'CROSS_ACCOUNT' });
  });
});

describe('org tự phục vụ (ADR-0025)', () => {
  it('người chưa thuộc org nào tạo org -> thành Owner, tạo được app; người khác không thấy org đó', async () => {
    const newbie = await userWith('newbie@test.local', []);
    const me = as(newbie);
    expect(await must(me('GET', '/me'), 200)).toMatchObject({ orgs: [] });

    const org = await must(me('POST', '/organizations', { name: '  Đội Mới  ' }), 201);
    expect(org).toMatchObject({ name: 'Đội Mới', accountId });
    const orgId = org['id'] as string;
    expect((await must(me('GET', '/me'), 200))['orgs']).toEqual([{ id: orgId, name: 'Đội Mới', role: 'owner' }]);

    const created = await must(me('POST', '/apps', { orgId, slug: 'doi-moi', name: 'Đội mới', namespace: 'doi-moi' }), 201);
    expect(created['status']).toBe('active');

    // Owner của org khác không thấy org này: 404, không phải 403.
    expect((await as(token.outsider)('GET', `/organizations/${orgId}`)).status).toBe(404);
  });

  it('tên trống -> 422; chưa đăng nhập -> 401', async () => {
    expect((await as(token.viewer)('POST', '/organizations', { name: '   ' })).status).toBe(422);
    expect((await http('POST', '/admin/organizations', { body: { name: 'X' } })).status).toBe(401);
  });
});
