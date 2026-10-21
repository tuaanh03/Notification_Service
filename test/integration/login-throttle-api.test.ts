import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import { admins } from '../../src/modules/tenancy/infrastructure/db/schema.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { AccountId } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient, signInAdmin, TEST_PASSWORD } from './support/http.ts';
import { race } from './support/race.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Chặn đăng nhập sai nhiều lần (ADR-0039) qua HTTP thật, MySQL + Redis thật: script Lua đếm / khoá, header IP có khoá
 * chung, cài đặt `auth.*` của Super Admin, màn khoá và mở khoá.
 */
const SECRET = 'khoa-chung-console-va-api-it-nhat-32';

let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;
let superToken: string;
let accountId: string;

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 5 });
  c = createContainer(
    loadEnv({
      DATABASE_URL: t.url,
      REDIS_URL: await testRedisUrl(),
      LOG_LEVEL: 'fatal',
      HOST: '127.0.0.1',
      PORT: '0',
      LOGIN_CLIENT_IP_SECRET: SECRET,
    }),
    { database: t, redis: await createTestRedis() },
  );
  application = buildApplication(c);
  api = await startApi(c, application);
  http = httpClient(api.url);
  const signedIn = await signInAdmin(application, api.url, { email: 'root@test.local' });
  superToken = signedIn.token;
  accountId = signedIn.accountId;
  const set = await http('PUT', '/admin/system-settings', {
    token: superToken,
    body: { values: { 'auth.max_failed_attempts': 3, 'auth.ip_max_failed_attempts': 10, 'auth.lockout_minutes': 15 } },
  });
  expect(set.status).toBe(200);
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

const ctx = { actor: { id: 'test', type: 'admin' as const }, source: 'system' as const };
async function createUser(email: string): Promise<void> {
  await application.adminOps.createAdmin.execute({ accountId: AccountId.parse(accountId), email, password: TEST_PASSWORD, role: 'user' }, ctx);
}

/** Như console: kèm IP của trình duyệt + khoá chung. `key = null` = không gửi header nào. */
async function login(email: string, password: string, ip: string | null = '203.0.113.7', key: string | null = SECRET): Promise<number> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null && ip !== null) {
    headers['x-ews-client-ip'] = ip;
    headers['x-ews-client-ip-key'] = key;
  }
  const res = await fetch(`${api.url}/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
  return res.status;
}

describe('chặn đăng nhập sai (ADR-0039)', () => {
  it('sai 3 lần -> khoá tạm: đúng mật khẩu cũng 401; Super Admin thấy khoá và mở được', async () => {
    await createUser('an@test.local');
    for (let i = 0; i < 3; i++) expect(await login('an@test.local', 'sai-mat-khau-roi', '198.51.100.1')).toBe(401);
    expect(await login('an@test.local', TEST_PASSWORD, '198.51.100.2')).toBe(401);

    const list = await http('GET', '/admin/login-locks', { token: superToken });
    expect(list.status).toBe(200);
    expect(list.body['locks']).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'email', subject: 'an@test.local', adminId: expect.any(String) })]),
    );

    expect((await http('POST', '/admin/login-locks/unlock', { token: superToken, body: { email: 'an@test.local' } })).status).toBe(200);
    expect(await login('an@test.local', TEST_PASSWORD, '198.51.100.2')).toBe(200);
    expect((await http('POST', '/admin/login-locks/unlock', { token: superToken, body: { email: 'an@test.local' } })).status).toBe(404);
  });

  it('nhiều bản api cùng ghi (song song) không lọt quá ngưỡng — script Lua nguyên tử', async () => {
    await createUser('binh@test.local');
    await race(8, () => login('binh@test.local', 'sai-mat-khau-roi', null));
    expect(await login('binh@test.local', TEST_PASSWORD, null)).toBe(401);
  });

  it('IP thử nhiều email -> IP bị khoá; IP khác vẫn vào; header IP sai khoá bị bỏ qua', async () => {
    await createUser('chi@test.local');
    for (let i = 0; i < 10; i++) await login(`do-${i}@test.local`, 'sai-mat-khau-roi', '192.0.2.50');
    expect(await login('chi@test.local', TEST_PASSWORD, '192.0.2.50')).toBe(401);
    // Sai khoá chung -> API không tin header, coi như không biết IP -> không dính khoá IP.
    expect(await login('chi@test.local', TEST_PASSWORD, '192.0.2.50', 'sai-khoa')).toBe(200);
    expect(await login('chi@test.local', TEST_PASSWORD, '192.0.2.51')).toBe(200);

    const locks = (await http('GET', '/admin/login-locks', { token: superToken })).body['locks'] as { kind: string; subject: string }[];
    expect(locks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ip', subject: '192.0.2.50' })]));
    expect((await http('POST', '/admin/login-locks/unlock', { token: superToken, body: { ip: '192.0.2.50' } })).status).toBe(200);
    expect(await login('chi@test.local', TEST_PASSWORD, '192.0.2.50')).toBe(200);
  });

  it('khoá hẳn sau N lần khoá tạm: ghi locked_at, đá phiên đang mở, chỉ mở bằng tay', async () => {
    await http('PUT', '/admin/system-settings', { token: superToken, body: { values: { 'auth.permanent_lock_after': 2 } } });
    await createUser('dung@test.local');
    const res = await fetch(`${api.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dung@test.local', password: TEST_PASSWORD }),
    });
    const session = ((await res.json()) as { token: string }).token;

    for (let i = 0; i < 3; i++) await login('dung@test.local', 'sai-mat-khau-roi', null);
    // Khoá tạm tự hết hạn: mô phỏng bằng xoá đúng khoá tạm, GIỮ chuỗi khoá liên tiếp.
    await c.infra.redis.client.del('login:lock:e:dung@test.local');
    for (let i = 0; i < 3; i++) await login('dung@test.local', 'sai-mat-khau-roi', null);

    const [row] = await t.db.select().from(admins).where(eq(admins.email, 'dung@test.local'));
    expect(row?.lockedAt).toBeInstanceOf(Date);
    expect((await http('GET', '/auth/me', { token: session })).status).toBe(401);
    const locks = (await http('GET', '/admin/login-locks', { token: superToken })).body['locks'] as { kind: string; subject: string }[];
    expect(locks.filter((l) => l.subject === 'dung@test.local').map((l) => l.kind)).toEqual(['account']);

    await c.infra.redis.client.del('login:lock:e:dung@test.local');
    expect(await login('dung@test.local', TEST_PASSWORD, null)).toBe(401);
    expect((await http('POST', '/admin/login-locks/unlock', { token: superToken, body: { email: 'dung@test.local' } })).status).toBe(200);
    expect(await login('dung@test.local', TEST_PASSWORD, null)).toBe(200);
    await http('PUT', '/admin/system-settings', { token: superToken, body: { values: { 'auth.permanent_lock_after': null } } });
  });

  it('chỉ Super Admin xem / mở khoá', async () => {
    await createUser('em@test.local');
    const res = await fetch(`${api.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'em@test.local', password: TEST_PASSWORD }),
    });
    const token = ((await res.json()) as { token: string }).token;
    expect((await http('GET', '/admin/login-locks', { token })).status).toBe(403);
    expect((await http('POST', '/admin/login-locks/unlock', { token, body: { email: 'an@test.local' } })).status).toBe(403);
  });
});
