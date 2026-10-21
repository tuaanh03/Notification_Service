import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { AccountId } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, signInAdmin, TEST_PASSWORD, type Json } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/** Quản lý tổ chức (2C): đổi tên, chuyển Owner, xoá (chỉ khi không còn app đang dùng được) — chỉ Owner / Super Admin. */
let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let rootToken: string;
let accountId: string;

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 5 });
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
    { database: t, redis: await createTestRedis() },
  );
  application = buildApplication(c);
  api = await startApi(c, application);
  http = httpClient(api.url);
  const s = await signInAdmin(application, api.url, { email: 'root@test.local' });
  rootToken = s.token;
  accountId = s.accountId;
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

async function user(email: string): Promise<{ token: string; id: string }> {
  const ctx = { actor: { id: 'test', type: 'admin' as const }, source: 'system' as const };
  const a = await application.adminOps.createAdmin.execute({ accountId: AccountId.parse(accountId), email, password: TEST_PASSWORD, role: 'user' }, ctx);
  const login = await http('POST', '/auth/login', { body: { email, password: TEST_PASSWORD } });
  return { token: login.body['token'] as string, id: a.id };
}
const as = (token: string) => (method: string, path: string, body?: unknown) =>
  http(method, `/admin${path}`, body === undefined ? { token } : { token, body });

describe('quản lý tổ chức (2C)', () => {
  it('Owner đổi tên; Org Admin không đổi được (OWNER_REQUIRED); tên rỗng 422', async () => {
    const owner = await user('owner1@test.local');
    const admin = await user('orgadmin1@test.local');
    const org = (await as(owner.token)('POST', '/organizations', { name: 'Đội A' })).body as Json;
    await as(owner.token)('PUT', `/organizations/${org['id']}/members`, { email: 'orgadmin1@test.local', role: 'org_admin' });

    expect((await as(owner.token)('PATCH', `/organizations/${org['id']}`, { name: 'Đội A mới' })).body).toMatchObject({ name: 'Đội A mới' });
    const denied = await as(admin.token)('PATCH', `/organizations/${org['id']}`, { name: 'Lén đổi' });
    expect([denied.status, JSON.stringify(denied.body).includes('OWNER_REQUIRED')]).toEqual([403, true]);
    expect((await as(owner.token)('PATCH', `/organizations/${org['id']}`, { name: '  ' })).status).toBe(422);
  });

  it('chuyển Owner: người được chọn thành Owner, Owner cũ thành Org Admin — org luôn có Owner', async () => {
    const owner = await user('owner2@test.local');
    const next = await user('next2@test.local');
    const org = (await as(owner.token)('POST', '/organizations', { name: 'Đội B' })).body as Json;
    const call = as(owner.token);
    expect((await call('POST', `/organizations/${org['id']}/transfer-owner`, { adminId: next.id })).status).toBe(422); // chưa là thành viên
    await call('PUT', `/organizations/${org['id']}/members`, { email: 'next2@test.local', role: 'member' });
    expect((await call('POST', `/organizations/${org['id']}/transfer-owner`, { adminId: next.id })).status).toBe(204);
    const members = (await as(next.token)('GET', `/organizations/${org['id']}/members`)).body as unknown as Json[];
    const roleOf = (email: string) => members.find((m) => m['email'] === email)?.['role'];
    expect([roleOf('next2@test.local'), roleOf('owner2@test.local')]).toEqual(['owner', 'org_admin']);
    // Owner cũ giờ là Org Admin -> không chuyển / đổi tên được nữa.
    expect((await call('PATCH', `/organizations/${org['id']}`, { name: 'x' })).status).toBe(403);
  });

  it('xoá: còn app -> 409 ORG_HAS_APPS; gõ sai tên -> 422; app đã thu hồi không chặn; xoá xong org biến mất', async () => {
    const owner = await user('owner3@test.local');
    const call = as(owner.token);
    const org = (await call('POST', '/organizations', { name: 'Đội C' })).body as Json;
    const app = (await call('POST', '/apps', { orgId: org['id'], slug: 'c-app', name: 'C', namespace: 'c-app' })).body as Json;

    const blocked = await call('DELETE', `/organizations/${org['id']}`, { confirmName: 'Đội C' });
    expect([blocked.status, JSON.stringify(blocked.body).includes('ORG_HAS_APPS')]).toEqual([409, true]);
    expect((await call('DELETE', `/organizations/${org['id']}`, { confirmName: 'Đội Cc' })).status).toBe(422);

    // Super Admin thu hồi app (trạng thái kết thúc) -> không còn chặn.
    expect((await as(rootToken)('POST', `/apps/${app['id']}/revoke`, { reason: 'test' })).status).toBeLessThan(300);
    expect((await call('DELETE', `/organizations/${org['id']}`, { confirmName: 'Đội C' })).status).toBe(204);
    expect((await as(rootToken)('GET', `/organizations/${org['id']}`)).status).toBe(404);
    const me = (await call('GET', '/me')).body as Json;
    expect((me['orgs'] as Json[]).some((o) => o['id'] === org['id'])).toBe(false);
  });
});
