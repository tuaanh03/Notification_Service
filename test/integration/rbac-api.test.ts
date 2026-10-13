import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { AccountId, AppId, ConflictError, OrgId, type AppRole, type OrgRole } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, signInAdmin, TEST_PASSWORD, type Json } from './support/http.ts';
import type { DirectoryPerson } from '../../src/modules/tenancy/application/ports/index.ts';
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
  application = buildApplication(c, {
    tenantDirectory: { configured: true, unavailableCode: 'M365_DIRECTORY_NOT_CONFIGURED', listPeople: async () => tenantPeople },
  });
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

/** Danh bạ M365 giả (ADR-0027) — test đổi `tenantPeople` rồi gọi đồng bộ. */
let tenantPeople: DirectoryPerson[] = [];

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

  it('topic BẮT BUỘC: người quản lý app tự đặt / bỏ (bổ sung ADR-0022); App Viewer -> 403', async () => {
    const appAdmin = as(token.appAdmin);
    const created = await appAdmin('POST', `/apps/${app.A1}/topics`, { key: 'must_read', name: 'M', mandatory: true });
    expect([created.status, created.body['mandatory']]).toEqual([201, true]);
    const off = await appAdmin('PUT', `/apps/${app.A1}/topics/must_read/mandatory`, { mandatory: false });
    expect([off.status, off.body['mandatory']]).toEqual([200, false]);
    const viewer = as(token.viewer);
    expect((await viewer('PUT', `/apps/${app.A1}/topics/must_read/mandatory`, { mandatory: true })).status).toBe(403);
    expect((await viewer('POST', `/apps/${app.A1}/topics`, { key: 'v_must', name: 'V', mandatory: true })).status).toBe(403);
  });

  it('duyệt / tạm ngưng app: chỉ Super Admin -> 403', async () => {
    const appAdmin = as(token.appAdmin);
    expect((await appAdmin('POST', `/apps/${app.A1}/approve`, { grantedChannels: ['email'] })).status).toBe(403);
    expect((await appAdmin('POST', `/apps/${app.A1}/suspend`)).status).toBe(403);
  });

  it('giới hạn IP: chỉ Super Admin xem / thêm / gỡ — App Admin, Owner đều 403 (bổ sung ADR-0023)', async () => {
    for (const who of [token.appAdmin, token.owner]) {
      const caller = as(who);
      expect((await caller('GET', `/apps/${app.A1}/network-rules`)).status).toBe(403);
      expect((await caller('POST', `/apps/${app.A1}/network-rules`, { kind: 'ip', value: '10.1.1.1' })).status).toBe(403);
      expect((await caller('DELETE', `/apps/${app.A1}/network-rules?kind=ip&value=10.1.1.1`)).status).toBe(403);
    }
    expect((await as(SUPER)('GET', `/apps/${app.A1}/network-rules`)).status).toBe(200);
    // Origin không còn là loại luật.
    expect((await as(SUPER)('POST', `/apps/${app.A1}/network-rules`, { kind: 'origin', value: 'https://a.test' })).status).toBe(422);
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

describe('màn Thành viên (ADR-0026)', () => {
  /** Org riêng cho nhóm test này: Owner tự tạo qua HTTP, không đụng org A / B của các test khác. */
  let orgId = '';
  let appId = '';
  const tk = { owner: '', admin: '', m1: '', stranger: '' };
  const idOf = async (email: string) => {
    const list = (await must(as(tk.owner)('GET', `/organizations/${orgId}/members`), 200)) as unknown as Json[];
    return list.find((m) => m['email'] === email)!['adminId'] as string;
  };

  beforeAll(async () => {
    tk.owner = await userWith('mem-owner@test.local', []);
    tk.admin = await userWith('mem-admin@test.local', []);
    tk.m1 = await userWith('mem-1@test.local', []);
    tk.stranger = await userWith('mem-stranger@test.local', []);
    orgId = (await must(as(tk.owner)('POST', '/organizations', { name: 'Org Thành viên' }), 201))['id'] as string;
    appId = (await must(as(tk.owner)('POST', '/apps', { orgId, slug: 'mem-x1', name: 'X1', namespace: 'mem-x1' }), 201))['id'] as string;
  });

  it('Owner thêm người bằng email; mọi thành viên xem được danh sách; Member không sửa được (403)', async () => {
    const owner = as(tk.owner);
    await must(owner('PUT', `/organizations/${orgId}/members`, { email: 'MEM-1@test.local', role: 'member' }), 200);
    await must(owner('PUT', `/organizations/${orgId}/members`, { email: 'mem-admin@test.local', role: 'org_admin' }), 200);
    const list = (await must(as(tk.m1)('GET', `/organizations/${orgId}/members`), 200)) as unknown as Json[];
    expect(list.map((m) => [m['email'], m['role']])).toEqual([
      ['mem-1@test.local', 'member'],
      ['mem-admin@test.local', 'org_admin'],
      ['mem-owner@test.local', 'owner'],
    ]);
    const res = await as(tk.m1)('PUT', `/organizations/${orgId}/members`, { email: 'mem-stranger@test.local', role: 'member' });
    expect([res.status, res.body['code']]).toEqual([403, 'FORBIDDEN']);
  });

  it('email chưa có tài khoản -> 422 ADMIN_NOT_REGISTERED; người ngoài org -> 404', async () => {
    const res = await as(tk.owner)('PUT', `/organizations/${orgId}/members`, { email: 'chua-co@test.local', role: 'member' });
    expect(res.status).toBe(422);
    expect((res.body['issues'] as Json[])[0]).toMatchObject({ code: 'ADMIN_NOT_REGISTERED', path: 'email' });
    expect((await as(tk.stranger)('GET', `/organizations/${orgId}/members`)).status).toBe(404);
  });

  it('Org Admin không động được vai Owner (403 OWNER_REQUIRED), vẫn đổi được vai thường', async () => {
    const admin = as(tk.admin);
    const promote = await admin('PUT', `/organizations/${orgId}/members`, { email: 'mem-1@test.local', role: 'owner' });
    expect([promote.status, promote.body['code']]).toEqual([403, 'OWNER_REQUIRED']);
    const kick = await admin('DELETE', `/organizations/${orgId}/members/${await idOf('mem-owner@test.local')}`);
    expect([kick.status, kick.body['code']]).toEqual([403, 'OWNER_REQUIRED']);
    await must(admin('PUT', `/organizations/${orgId}/members`, { email: 'mem-1@test.local', role: 'member' }), 200);
  });

  it('cấp / thu hồi vai app; chỉ cấp cho thành viên org (409 NOT_ORG_MEMBER)', async () => {
    const m1 = await idOf('mem-1@test.local');
    await must(as(tk.admin)('PUT', `/apps/${appId}/roles`, { email: 'mem-1@test.local', role: 'app_viewer' }), 200);
    expect(await must(as(tk.owner)('GET', `/organizations/${orgId}/app-roles`), 200)).toEqual([{ adminId: m1, appId, role: 'app_viewer' }]);
    expect((await as(tk.m1)('GET', `/apps/${appId}`)).status).toBe(200);

    expect((await as(tk.owner)('DELETE', `/apps/${appId}/roles/${m1}`)).status).toBe(204);
    expect((await as(tk.m1)('GET', `/apps/${appId}`)).status).toBe(403);

    const outsider = await as(tk.owner)('PUT', `/apps/${appId}/roles`, { email: 'mem-stranger@test.local', role: 'app_viewer' });
    expect([outsider.status, outsider.body['code']]).toEqual([409, 'NOT_ORG_MEMBER']);
  });

  it('gỡ khỏi org thu hồi luôn vai app — thêm lại thì quyền cũ KHÔNG tự sống lại', async () => {
    const m1 = await idOf('mem-1@test.local');
    await must(as(tk.owner)('PUT', `/apps/${appId}/roles`, { email: 'mem-1@test.local', role: 'app_admin' }), 200);
    expect((await as(tk.owner)('DELETE', `/organizations/${orgId}/members/${m1}`)).status).toBe(204);
    expect((await as(tk.m1)('GET', `/organizations/${orgId}/members`)).status).toBe(404);
    expect(await must(as(tk.owner)('GET', `/organizations/${orgId}/app-roles`), 200)).toEqual([]);

    await must(as(tk.owner)('PUT', `/organizations/${orgId}/members`, { email: 'mem-1@test.local', role: 'member' }), 200);
    expect((await as(tk.m1)('GET', `/apps/${appId}`)).status).toBe(403);
  });

  it('Owner cuối cùng không tự gỡ được mình (409 LAST_OWNER)', async () => {
    const res = await as(tk.owner)('DELETE', `/organizations/${orgId}/members/${await idOf('mem-owner@test.local')}`);
    expect([res.status, res.body['code']]).toEqual([409, 'LAST_OWNER']);
  });
});

describe('danh bạ M365 (ADR-0027)', () => {
  /** Org riêng: các nhóm test trên đã đổi vai trong org A / B. */
  let orgId = '';
  const tk = { owner: '', member: '' };

  beforeAll(async () => {
    tk.owner = await userWith('dir-owner@test.local', []);
    tk.member = await userWith('dir-member@test.local', []);
    orgId = (await must(as(tk.owner)('POST', '/organizations', { name: 'Org Danh bạ' }), 201))['id'] as string;
    await must(as(tk.owner)('PUT', `/organizations/${orgId}/members`, { email: 'dir-member@test.local', role: 'member' }), 200);
  });

  it('chỉ Super Admin đồng bộ được; Owner một org cũng không (403)', async () => {
    const res = await as(tk.owner)('POST', '/directory/m365-sync');
    expect([res.status, res.body['code']]).toEqual([403, 'FORBIDDEN']);
  });

  it('đồng bộ tạo tài khoản kèm tên; Owner thấy họ trong danh sách để chọn rồi thêm vào org', async () => {
    tenantPeople = [
      { oid: 'oid-nv1', email: 'NV1@test.local', displayName: 'Nhân Viên Một' },
      // Đã có tài khoản (tạo bằng mật khẩu), chưa gắn oid -> gắn + đặt tên.
      { oid: 'oid-dir-member', email: 'dir-member@test.local', displayName: 'Thành Viên' },
    ];
    const result = await must(as(SUPER)('POST', '/directory/m365-sync'), 200);
    expect(result).toMatchObject({ total: 2, created: 1, linked: 1, conflicts: 0 });

    // Người mới từ danh bạ chưa hiện: không có trong hộp chọn, thêm thẳng bằng API cũng bị chặn.
    const owner = as(tk.owner);
    const hidden = (await must(owner('GET', `/organizations/${orgId}/member-candidates`), 200)) as unknown as Json[];
    expect(hidden.map((c) => c['email'])).not.toContain('nv1@test.local');
    const blocked = await owner('PUT', `/organizations/${orgId}/members`, { email: 'nv1@test.local', role: 'member' });
    expect(blocked.status).toBe(422);
    expect((blocked.body['issues'] as Json[])[0]).toMatchObject({ code: 'ADMIN_NOT_LISTED', path: 'email' });

    // Super Admin tích ở màn Danh bạ.
    const page = await must(as(SUPER)('GET', '/directory/people?q=nv1&listed=no'), 200);
    const nv1 = (page['items'] as Json[])[0]!;
    expect(nv1).toMatchObject({ email: 'nv1@test.local', displayName: 'Nhân Viên Một', m365Linked: true, memberListed: false });
    expect(page['total']).toBe(1);
    expect(await must(as(SUPER)('PUT', '/directory/people/member-listed', { adminIds: [nv1['adminId']], listed: true }), 200)).toEqual({
      changed: 1,
    });

    const candidates = (await must(owner('GET', `/organizations/${orgId}/member-candidates`), 200)) as unknown as Json[];
    expect(candidates).toContainEqual(expect.objectContaining({ email: 'nv1@test.local', displayName: 'Nhân Viên Một' }));
    // Người đã là thành viên org không nằm trong danh sách.
    expect(candidates.map((c) => c['email'])).not.toContain('dir-member@test.local');

    await must(owner('PUT', `/organizations/${orgId}/members`, { email: 'nv1@test.local', role: 'member' }), 200);
    const members = (await must(owner('GET', `/organizations/${orgId}/members`), 200)) as unknown as Json[];
    expect(members).toContainEqual(expect.objectContaining({ email: 'nv1@test.local', displayName: 'Nhân Viên Một' }));
    expect(members).toContainEqual(expect.objectContaining({ email: 'dir-member@test.local', displayName: 'Thành Viên' }));
    const after = (await must(owner('GET', `/organizations/${orgId}/member-candidates`), 200)) as unknown as Json[];
    expect(after.map((c) => c['email'])).not.toContain('nv1@test.local');
  });

  it('màn Danh bạ chỉ Super Admin; bỏ tích không gỡ người đang là thành viên, vẫn đổi vai được', async () => {
    expect((await as(tk.owner)('GET', '/directory/people')).status).toBe(403);
    expect((await as(tk.owner)('PUT', '/directory/people/member-listed', { adminIds: [], listed: true })).status).toBe(403);

    const page = await must(as(SUPER)('GET', '/directory/people?q=dir-member'), 200);
    const member = (page['items'] as Json[])[0]!;
    expect(await must(as(SUPER)('PUT', '/directory/people/member-listed', { adminIds: [member['adminId']], listed: false }), 200)).toEqual({
      changed: 1,
    });
    // Tích lại cùng giá trị -> không đổi gì.
    expect(await must(as(SUPER)('PUT', '/directory/people/member-listed', { adminIds: [member['adminId']], listed: false }), 200)).toEqual({
      changed: 0,
    });
    const owner = as(tk.owner);
    const members = (await must(owner('GET', `/organizations/${orgId}/members`), 200)) as unknown as Json[];
    expect(members.map((m) => m['email'])).toContain('dir-member@test.local');
    await must(owner('PUT', `/organizations/${orgId}/members`, { email: 'dir-member@test.local', role: 'org_admin' }), 200);
    await must(owner('PUT', `/organizations/${orgId}/members`, { email: 'dir-member@test.local', role: 'member' }), 200);
  });

  it('Member không xem được danh sách để chọn (403); người ngoài org -> 404', async () => {
    expect((await as(tk.member)('GET', `/organizations/${orgId}/member-candidates`)).status).toBe(403);
    expect((await as(token.outsider)('GET', `/organizations/${orgId}/member-candidates`)).status).toBe(404);
  });

  it('hai lượt đồng bộ chạy song song -> mỗi người đúng MỘT tài khoản, không lượt nào lỗi', async () => {
    tenantPeople = Array.from({ length: 5 }, (_, i) => ({ oid: `oid-song-${i}`, email: `song-${i}@test.local`, displayName: `Song ${i}` }));
    const results = await race(2, () => must(as(SUPER)('POST', '/directory/m365-sync'), 200));
    expect(rejected(results)).toEqual([]);
    const created = results.map((r) => (r.status === 'fulfilled' ? (r.value['created'] as number) : -1));
    expect(created.reduce((a, b) => a + b, 0)).toBe(5);
    const page = await must(as(SUPER)('GET', '/directory/people?q=song-&listed=no'), 200);
    expect(page['total']).toBe(5);
  });
});
