import { generateKeyPairSync, sign } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApplication, createContainer, type Application, type Container } from '../../src/composition/index.ts';
import { startApi, type RunningApi } from '../../src/entrypoints/index.ts';
import {
  EntraIdMicrosoftIdentity,
  RedisLoginStateStore,
} from '../../src/modules/tenancy/infrastructure/adapters/index.ts';
import { admins } from '../../src/modules/tenancy/infrastructure/db/schema.ts';
import { loadEnv } from '../../src/shared/config/index.ts';
import { AccountId } from '../../src/shared/kernel/index.ts';
import { createTestDatabase, type TestDatabase } from './support/database.ts';
import { httpClient } from './support/http.ts';
import { createTestRedis, testRedisUrl } from './support/redis.ts';

/**
 * Đăng nhập M365 qua HTTP thật, MySQL + Redis thật (ADR-0021). Chỉ phía Microsoft là giả: fetch giả
 * trả khoá ký và `id_token` ký bằng khoá RSA sinh tại chỗ. Bước kiểm token chi tiết ở test unit.
 */
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const KEY = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** Người đang "đăng nhập ở Microsoft" ở lượt tới. */
let microsoftUser = { oid: 'oid-an', email: 'an@company.com' };

function idToken(nonce: string): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = `${enc({ alg: 'RS256', kid: 'k1' })}.${enc({
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    aud: CLIENT,
    tid: TENANT,
    nonce,
    exp: now + 3600,
    nbf: now - 60,
    ...microsoftUser,
  })}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), KEY.privateKey).toString('base64url')}`;
}

let lastNonce = '';
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith('/discovery/v2.0/keys')) {
    return Response.json({ keys: [{ ...KEY.publicKey.export({ format: 'jwk' }), kid: 'k1' }] });
  }
  return Response.json({ id_token: idToken(lastNonce) });
}) as typeof fetch;

let t: TestDatabase;
let c: Container;
let application: Application;
let api: RunningApi;
let http: ReturnType<typeof httpClient>;

beforeAll(async () => {
  t = await createTestDatabase({ poolSize: 5 });
  const redis = await createTestRedis();
  c = createContainer(
    loadEnv({ DATABASE_URL: t.url, REDIS_URL: await testRedisUrl(), LOG_LEVEL: 'fatal', HOST: '127.0.0.1', PORT: '0' }),
    { database: t, redis },
  );
  const microsoftIdentity = new EntraIdMicrosoftIdentity({
    config: { tenantId: TENANT, clientId: CLIENT, clientSecret: 's', redirectUri: 'https://console.test/cb', timeoutMs: 1000 },
    states: new RedisLoginStateStore({ redis: redis.client }),
    clock: c.ports.clock,
    fetch: fakeFetch,
  });
  application = buildApplication(c, { microsoftIdentity });
  api = await startApi(c, application);
  http = httpClient(api.url);

  const ctx = { actor: { id: 'test', type: 'admin' as const }, source: 'system' as const };
  const account = await application.adminOps.createAccount.execute({ name: 'M365' }, ctx);
  // Chỉ M365, không mật khẩu — đúng đường `admin-cli create-admin --login m365`.
  await application.adminOps.createAdmin.execute(
    { accountId: AccountId.parse(account.id), email: 'An@Company.com', password: null, role: 'app_admin' },
    ctx,
  );
});
afterAll(async () => {
  await api?.stop();
  await c?.dispose();
});

/** Một lượt như console: start -> (người dùng đăng nhập ở Microsoft) -> callback. */
async function signInWithMicrosoft(state?: string) {
  const start = await http('POST', '/auth/m365/start');
  expect(start.status).toBe(200);
  lastNonce = new URL(start.body['authorizeUrl'] as string).searchParams.get('nonce')!;
  return http('POST', '/auth/m365/callback', { body: { code: 'ma-tu-microsoft', state: state ?? start.body['state'] } });
}

describe('đăng nhập Microsoft 365', () => {
  it('GET /auth/m365 báo đã bật', async () => {
    expect((await http('GET', '/auth/m365')).body).toEqual({ enabled: true });
  });

  it('lần đầu: khớp email -> gắn oid vào admin, phiên dùng được cho /auth/me và /admin', async () => {
    const res = await signInWithMicrosoft();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const token = res.body['token'] as string;

    expect((await http('GET', '/auth/me', { token })).body).toMatchObject({ email: 'an@company.com' });
    // Qua được cửa xác thực của /admin (thiếu query nên 422 — không phải 401).
    expect((await http('GET', '/admin/audit', { token })).status).not.toBe(401);
    expect((await http('GET', '/admin/audit', { token: null })).status).toBe(401);

    const [row] = await t.db.select().from(admins).where(eq(admins.email, 'an@company.com'));
    expect(row?.microsoftOid).toBe('oid-an');
  });

  it('lần sau: email trên M365 đã đổi vẫn vào đúng tài khoản nhờ oid', async () => {
    microsoftUser = { oid: 'oid-an', email: 'an.nguyen@company.com' };
    const res = await signInWithMicrosoft();
    expect(res.status).toBe(200);
    expect(res.body['admin']).toMatchObject({ email: 'an@company.com' });
  });

  it('state lạ -> 401 M365_STATE_INVALID; state chỉ dùng được một lần', async () => {
    expect((await signInWithMicrosoft('state-gia')).body['code']).toBe('M365_STATE_INVALID');

    microsoftUser = { oid: 'oid-an', email: 'an@company.com' };
    const start = await http('POST', '/auth/m365/start');
    lastNonce = new URL(start.body['authorizeUrl'] as string).searchParams.get('nonce')!;
    const body = { code: 'c', state: start.body['state'] };
    expect((await http('POST', '/auth/m365/callback', { body })).status).toBe(200);
    const replay = await http('POST', '/auth/m365/callback', { body });
    expect([replay.status, replay.body['code']]).toEqual([401, 'M365_STATE_INVALID']);
  });

  it('người chưa có tài khoản EWS -> 403 M365_ACCOUNT_NOT_REGISTERED', async () => {
    microsoftUser = { oid: 'oid-la', email: 'la@company.com' };
    const res = await signInWithMicrosoft();
    expect([res.status, res.body['code']]).toEqual([403, 'M365_ACCOUNT_NOT_REGISTERED']);
  });

  it('email của admin đã gắn tài khoản Microsoft khác -> 403 M365_ACCOUNT_MISMATCH', async () => {
    microsoftUser = { oid: 'oid-ke-gia', email: 'an@company.com' };
    const res = await signInWithMicrosoft();
    expect([res.status, res.body['code']]).toEqual([403, 'M365_ACCOUNT_MISMATCH']);
  });

  it('admin chỉ M365 không đăng nhập được bằng mật khẩu', async () => {
    const res = await http('POST', '/auth/login', { body: { email: 'an@company.com', password: 'bat-ky-mat-khau-nao' } });
    expect([res.status, res.body['code']]).toEqual([401, 'INVALID_CREDENTIALS']);
  });

  it('body sai dạng -> 422', async () => {
    expect((await http('POST', '/auth/m365/callback', { body: { code: '' } })).status).toBe(422);
  });
});
