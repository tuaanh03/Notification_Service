import type { Application } from '../../../src/composition/index.ts';
import { AccountId } from '../../../src/shared/kernel/index.ts';

export type Json = Record<string, any>;

export interface HttpResult {
  status: number;
  body: Json;
  headers: Headers;
}

/** Client HTTP tối giản cho test: `token` = Bearer (admin token hoặc API key), `null` = không gửi. */
export function httpClient(baseUrl: string) {
  return async (method: string, path: string, opts: { token?: string | null; body?: unknown } = {}): Promise<HttpResult> => {
    const headers: Record<string, string> = {};
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Json, headers: res.headers };
  };
}

/**
 * Dựng một app service sẵn sàng gọi `/v1/*` qua đúng API thật: account -> org -> app -> duyệt (kênh
 * email) -> cấp API key. Trả API key để test gọi `/v1` như app service thật.
 */
export async function provisionApp(
  baseUrl: string,
  adminToken: string,
  slug: string,
): Promise<{ appId: string; orgId: string; apiKey: string }> {
  const http = httpClient(baseUrl);
  const admin = (method: string, path: string, body?: unknown) =>
    http(method, `/admin${path}`, body === undefined ? { token: adminToken } : { token: adminToken, body });
  const must = (r: HttpResult, status: number, step: string): Json => {
    if (r.status !== status) throw new Error(`${step}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  const account = must(await admin('POST', '/accounts', { name: `Acc ${slug}` }), 201, 'create account');
  const org = must(await admin('POST', `/accounts/${account['id']}/organizations`, { name: `Org ${slug}` }), 201, 'create org');
  const app = must(await admin('POST', '/apps', { orgId: org['id'], slug, name: `App ${slug}`, namespace: slug }), 201, 'create app');
  must(await admin('POST', `/apps/${app['id']}/submit`), 200, 'submit app');
  must(await admin('POST', `/apps/${app['id']}/approve`, { grantedChannels: ['email'] }), 200, 'approve app');
  const key = must(await admin('POST', `/apps/${app['id']}/secrets`), 201, 'issue key');
  return { appId: app['id'] as string, orgId: org['id'] as string, apiKey: key['apiKey'] as string };
}

/** Mật khẩu test: phải đạt MIN_PASSWORD_LENGTH của `password-policy.ts`. */
export const TEST_PASSWORD = 'test-password-1234';

/**
 * Dựng quyền quản trị cho test: account -> admin -> ĐĂNG NHẬP, trả token phiên.
 *
 * Hai bước đầu đi thẳng qua `adminOps` — đúng đường mà `admin-cli` dùng trên máy chủ thật, vì
 * không có route HTTP nào tạo admin được (xem `run-admin-cli.ts`). Bước đăng nhập thì qua HTTP
 * thật, nên test cũng kiểm luôn `/auth/login`.
 *
 * Thay cho `ADMIN_TOKEN` cũ: từ nay không còn token dùng chung nào trong env.
 */
export async function signInAdmin(
  application: Application,
  baseUrl: string,
  opts: { email?: string; accountName?: string } = {},
): Promise<{ token: string; accountId: string; adminId: string }> {
  const ctx = { actor: { id: 'test', type: 'admin' as const }, source: 'system' as const };
  const email = opts.email ?? `admin-${Math.random().toString(36).slice(2, 10)}@test.local`;

  const account = await application.adminOps.createAccount.execute({ name: opts.accountName ?? 'Test Account' }, ctx);
  const admin = await application.adminOps.createAdmin.execute(
    { accountId: AccountId.parse(account.id), email, password: TEST_PASSWORD, role: 'super_admin' },
    ctx,
  );

  const res = await httpClient(baseUrl)('POST', '/auth/login', { body: { email, password: TEST_PASSWORD } });
  if (res.status !== 200) throw new Error(`login: expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body['token'] as string, accountId: account.id, adminId: admin.id };
}
