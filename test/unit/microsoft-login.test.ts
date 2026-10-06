import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountId, AdminId, DomainError, fixedClock, UpstreamError, type Clock, type NormalizedEmail } from '../../src/shared/kernel/index.ts';
import type { EventOutbox, IntegrationEvent, UnitOfWork } from '../../src/shared/application/index.ts';
import { Admin } from '../../src/modules/tenancy/domain/entities/admin.ts';
import type { AdminSession } from '../../src/modules/tenancy/domain/entities/admin-session.ts';
import { LoginAdminWithMicrosoft } from '../../src/modules/tenancy/application/commands/login-admin-with-microsoft.ts';
import { StartMicrosoftLogin } from '../../src/modules/tenancy/application/commands/start-microsoft-login.ts';
import type {
  AdminRepository,
  AdminSessionRepository,
  MicrosoftIdentity,
  MicrosoftProfile,
} from '../../src/modules/tenancy/application/ports/index.ts';
import { RandomSessionTokenFactory } from '../../src/modules/tenancy/infrastructure/adapters/random-session-token-factory.ts';
import {
  DisabledMicrosoftIdentity,
  EntraIdMicrosoftIdentity,
} from '../../src/modules/tenancy/infrastructure/adapters/entra-id-microsoft-identity.ts';
import type { LoginStateStore } from '../../src/modules/tenancy/infrastructure/adapters/redis-login-state-store.ts';

const NOW = new Date('2026-10-06T08:00:00.000Z');
const clock: Clock = fixedClock(NOW);
const CTX = { actor: { id: 'microsoft', type: 'admin' as const }, source: 'admin_api' as const };
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const REDIRECT = 'https://console.test/auth/callback/microsoft';

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return '(không ném lỗi)';
  } catch (err) {
    return err instanceof DomainError ? err.code : String(err);
  }
};

// --- LoginAdminWithMicrosoft: luật khớp tài khoản ------------------------------------------------

const uow: UnitOfWork = { run: async (work) => work() };
class FakeOutbox implements EventOutbox {
  readonly events: IntegrationEvent[] = [];
  async append(events: readonly IntegrationEvent[]): Promise<void> {
    this.events.push(...events);
  }
}
class FakeSessions implements AdminSessionRepository {
  rows: AdminSession[] = [];
  async insert(session: AdminSession): Promise<void> {
    this.rows.push(session);
  }
  async findByTokenHash(): Promise<AdminSession | null> {
    return null;
  }
  async deleteById(): Promise<void> {}
  async deleteByAdmin(): Promise<void> {}
}
class FakeAdmins implements AdminRepository {
  readonly rows: Admin[];
  /** Mô phỏng lần đăng nhập song song đã gắn `oid` này vào DB trước. */
  linkedConcurrently: string | null = null;

  constructor(rows: Admin[]) {
    this.rows = rows;
  }
  async findById(id: string) {
    const row = this.rows.find((a) => a.id === id) ?? null;
    if (row && this.linkedConcurrently !== null) return copy(row, this.linkedConcurrently);
    return row;
  }
  async findByEmail(email: NormalizedEmail) {
    return this.rows.find((a) => a.email === email) ?? null;
  }
  async findByMicrosoftOid(oid: string) {
    return this.rows.find((a) => a.microsoftOid === oid) ?? null;
  }
  async insert() {}
  async updatePassword() {}
  async linkMicrosoft() {
    return this.linkedConcurrently === null;
  }
  async countByAccount() {
    return this.rows.length;
  }
}

const copy = (a: Admin, microsoftOid: string | null) =>
  new Admin({ id: a.id, accountId: a.accountId, email: a.email, role: a.role, microsoftOid, createdAt: NOW });

const admin = (email: string, microsoftOid: string | null = null) =>
  new Admin({ id: AdminId.create(), accountId: AccountId.create(), email, role: 'user', microsoftOid, createdAt: NOW });

const identityReturning = (profile: MicrosoftProfile): MicrosoftIdentity => ({
  configured: true,
  begin: async () => ({ authorizeUrl: 'https://login.test', state: 's' }),
  complete: async () => profile,
});

function setup(admins: Admin[], profile: MicrosoftProfile) {
  const repo = new FakeAdmins(admins);
  const sessions = new FakeSessions();
  const outbox = new FakeOutbox();
  const login = new LoginAdminWithMicrosoft({
    uow,
    outbox,
    clock,
    sessions,
    tokens: new RandomSessionTokenFactory(),
    sessionTtlMs: 1000,
    identity: identityReturning(profile),
    admins: repo,
  });
  return { repo, sessions, outbox, run: () => login.execute({ code: 'c', state: 's' }, CTX) };
}

describe('LoginAdminWithMicrosoft', () => {
  it('lần đầu: khớp email (khác hoa/thường) -> gắn oid, tạo phiên, audit cả hai việc', async () => {
    const a = admin('an@company.com');
    const { sessions, outbox, run } = setup([a], { oid: 'oid-1', email: 'An@Company.com' });
    const result = await run();
    expect(result.admin.id).toBe(a.id);
    expect(a.microsoftOid).toBe('oid-1');
    expect(sessions.rows).toHaveLength(1);
    expect(outbox.events.map((e) => e.eventType)).toEqual(['AdminMicrosoftLinked', 'AdminSignedIn']);
    expect(outbox.events[1]?.payload).toMatchObject({ actor: { id: a.id }, after: { method: 'microsoft' } });
  });

  it('đã gắn: tra theo oid — email trên M365 đổi rồi vẫn vào đúng tài khoản', async () => {
    const a = admin('an@company.com', 'oid-1');
    const { outbox, run } = setup([a], { oid: 'oid-1', email: 'an.nguyen@company.com' });
    expect((await run()).admin.id).toBe(a.id);
    expect(outbox.events.map((e) => e.eventType)).toEqual(['AdminSignedIn']);
  });

  it('không cần mật khẩu — admin chỉ dùng M365 vẫn vào được', async () => {
    const a = admin('an@company.com');
    expect(a.passwordHash).toBeNull();
    expect((await setup([a], { oid: 'oid-1', email: 'an@company.com' }).run()).admin.id).toBe(a.id);
  });

  it('email chưa có tài khoản EWS -> 403 M365_ACCOUNT_NOT_REGISTERED, không tạo gì', async () => {
    const { sessions, outbox, run } = setup([admin('an@company.com')], { oid: 'oid-9', email: 'la@company.com' });
    expect(await codeOf(run())).toBe('M365_ACCOUNT_NOT_REGISTERED');
    expect(sessions.rows).toHaveLength(0);
    expect(outbox.events).toHaveLength(0);
  });

  it('token không có email -> M365_ACCOUNT_NOT_REGISTERED', async () => {
    expect(await codeOf(setup([admin('an@company.com')], { oid: 'oid-1', email: null }).run())).toBe('M365_ACCOUNT_NOT_REGISTERED');
  });

  it('admin đã gắn tài khoản Microsoft KHÁC -> M365_ACCOUNT_MISMATCH, không đè', async () => {
    const a = admin('an@company.com', 'oid-cu');
    const { sessions, run } = setup([a], { oid: 'oid-moi', email: 'an@company.com' });
    expect(await codeOf(run())).toBe('M365_ACCOUNT_MISMATCH');
    expect(a.microsoftOid).toBe('oid-cu');
    expect(sessions.rows).toHaveLength(0);
  });

  it('hai lần đăng nhập đầu chạy song song, lần kia gắn CÙNG oid trước -> vẫn vào', async () => {
    const { repo, outbox, run } = setup([admin('an@company.com')], { oid: 'oid-1', email: 'an@company.com' });
    repo.linkedConcurrently = 'oid-1';
    await run();
    expect(outbox.events.map((e) => e.eventType)).toEqual(['AdminSignedIn']);
  });

  it('lần kia gắn oid KHÁC trước -> M365_ACCOUNT_MISMATCH', async () => {
    const { repo, run } = setup([admin('an@company.com')], { oid: 'oid-1', email: 'an@company.com' });
    repo.linkedConcurrently = 'oid-khac';
    expect(await codeOf(run())).toBe('M365_ACCOUNT_MISMATCH');
  });

  it('chưa cấu hình M365_* -> 503 M365_NOT_CONFIGURED ở cả hai bước', async () => {
    const identity = new DisabledMicrosoftIdentity();
    const start = new StartMicrosoftLogin({ identity });
    expect(start.configured).toBe(false);
    expect(await codeOf(start.execute())).toBe('M365_NOT_CONFIGURED');
    const login = new LoginAdminWithMicrosoft({
      uow,
      outbox: new FakeOutbox(),
      clock,
      sessions: new FakeSessions(),
      tokens: new RandomSessionTokenFactory(),
      sessionTtlMs: 1000,
      identity,
      admins: new FakeAdmins([]),
    });
    const err = await login.execute({ code: 'c', state: 's' }, CTX).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).status).toBe(503);
  });
});

// --- EntraIdMicrosoftIdentity: giả lập Microsoft bằng fetch giả + khoá RSA sinh tại chỗ -----------

class MemoryStates implements LoginStateStore {
  readonly rows = new Map<string, string>();
  async save(state: string, value: string) {
    this.rows.set(state, value);
  }
  async take(state: string) {
    const value = this.rows.get(state) ?? null;
    this.rows.delete(state);
    return value;
  }
}

const keyPair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const MS_KEY = keyPair();
const OTHER_KEY = keyPair();

function jwt(claims: Record<string, unknown>, key: KeyObject = MS_KEY.privateKey, kid = 'kid-1'): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = `${enc({ alg: 'RS256', typ: 'JWT', kid })}.${enc(claims)}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
}

/** Microsoft giả: trả token theo `tokenFor(nonce)`, ghi lại mọi request để kiểm PKCE. */
function fakeMicrosoft(options: {
  idToken?: (nonce: string) => string;
  tokenStatus?: number;
  tokenError?: string;
}) {
  const calls: { url: string; body: URLSearchParams | null }[] = [];
  let nonce = '';
  let keysFetched = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? new URLSearchParams(init.body) : null });
    if (url.endsWith('/discovery/v2.0/keys')) {
      keysFetched++;
      return Response.json({ keys: [{ ...MS_KEY.publicKey.export({ format: 'jwk' }), kid: 'kid-1', use: 'sig' }] });
    }
    if (options.tokenStatus !== undefined) {
      return Response.json({ error: options.tokenError }, { status: options.tokenStatus });
    }
    return Response.json({ id_token: (options.idToken ?? validToken)(nonce), token_type: 'Bearer' });
  }) as typeof fetch;

  const identity = new EntraIdMicrosoftIdentity({
    config: { tenantId: TENANT, clientId: CLIENT, clientSecret: 'secret-khong-duoc-lo', redirectUri: REDIRECT, timeoutMs: 1000 },
    states: new MemoryStates(),
    clock,
    fetch: fetchFn,
  });
  /** Bắt đầu một lượt như trình duyệt: lấy state + nonce từ URL Microsoft. */
  const begin = async () => {
    const { authorizeUrl, state } = await identity.begin();
    const url = new URL(authorizeUrl);
    nonce = url.searchParams.get('nonce') ?? '';
    return { url, state };
  };
  return { identity, calls, begin, keysFetched: () => keysFetched };
}

const exp = Math.floor(NOW.getTime() / 1000) + 3600;
const validClaims = (nonce: string) => ({
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  aud: CLIENT,
  tid: TENANT,
  oid: 'oid-1',
  email: 'an@company.com',
  nonce,
  exp,
  nbf: exp - 3600,
});
const validToken = (nonce: string) => jwt(validClaims(nonce));

describe('EntraIdMicrosoftIdentity', () => {
  it('URL đăng nhập: đúng tenant, client, redirect, PKCE S256; state và nonce ngẫu nhiên', async () => {
    const { begin } = fakeMicrosoft({});
    const { url, state } = await begin();
    expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge_method: 'S256',
      state,
    });
    expect(state).not.toBe((await begin()).state);
  });

  it('đủ bước hợp lệ -> trả oid + email; gửi code_verifier khớp code_challenge', async () => {
    const ms = fakeMicrosoft({});
    const { url, state } = await ms.begin();
    expect(await ms.identity.complete({ code: 'ma-tu-microsoft', state })).toEqual({ oid: 'oid-1', email: 'an@company.com' });
    const tokenCall = ms.calls.find((c) => c.url.endsWith('/oauth2/v2.0/token'))!;
    const verifier = tokenCall.body!.get('code_verifier')!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(tokenCall.body!.get('redirect_uri')).toBe(REDIRECT);
  });

  it('không có claim email -> dùng preferred_username', async () => {
    const ms = fakeMicrosoft({ idToken: (n) => jwt({ ...validClaims(n), email: undefined, preferred_username: 'an@company.com' }) });
    const { state } = await ms.begin();
    expect((await ms.identity.complete({ code: 'c', state })).email).toBe('an@company.com');
  });

  it('state lạ, hoặc dùng lại state đã xong -> M365_STATE_INVALID', async () => {
    const ms = fakeMicrosoft({});
    expect(await codeOf(ms.identity.complete({ code: 'c', state: 'khong-co' }))).toBe('M365_STATE_INVALID');
    const { state } = await ms.begin();
    await ms.identity.complete({ code: 'c', state });
    expect(await codeOf(ms.identity.complete({ code: 'c', state }))).toBe('M365_STATE_INVALID');
  });

  const rejected: [string, (nonce: string) => string][] = [
    ['ký bằng khoá khác', (n) => jwt(validClaims(n), OTHER_KEY.privateKey)],
    ['nonce khác', (n) => jwt({ ...validClaims(n), nonce: 'nonce-khac' })],
    ['aud là app khác', (n) => jwt({ ...validClaims(n), aud: 'app-khac' })],
    ['tenant khác', (n) => jwt({ ...validClaims(n), tid: '99999999-2222-3333-4444-555555555555' })],
    ['issuer khác', (n) => jwt({ ...validClaims(n), iss: 'https://login.microsoftonline.com/common/v2.0' })],
    ['đã hết hạn', (n) => jwt({ ...validClaims(n), exp: Math.floor(NOW.getTime() / 1000) - 3600 })],
    ['thiếu oid', (n) => jwt({ ...validClaims(n), oid: undefined })],
    ['khoá ký lạ', (n) => jwt(validClaims(n), MS_KEY.privateKey, 'kid-la')],
    ['không phải JWT', () => 'rac'],
  ];
  it.each(rejected)('id_token %s -> M365_TOKEN_INVALID', async (_name, idToken) => {
    const ms = fakeMicrosoft({ idToken });
    const { state } = await ms.begin();
    expect(await codeOf(ms.identity.complete({ code: 'c', state }))).toBe('M365_TOKEN_INVALID');
  });

  it('mã đã dùng / hết hạn (invalid_grant) -> 401 M365_SIGN_IN_FAILED', async () => {
    const ms = fakeMicrosoft({ tokenStatus: 400, tokenError: 'invalid_grant' });
    const { state } = await ms.begin();
    expect(await codeOf(ms.identity.complete({ code: 'c', state }))).toBe('M365_SIGN_IN_FAILED');
  });

  it('secret sai / hết hạn (invalid_client) -> 502 M365_PROVIDER_ERROR, message không chứa secret', async () => {
    const ms = fakeMicrosoft({ tokenStatus: 401, tokenError: 'invalid_client' });
    const { state } = await ms.begin();
    const err = await ms.identity.complete({ code: 'c', state }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).code).toBe('M365_PROVIDER_ERROR');
    expect((err as UpstreamError).message).not.toContain('secret-khong-duoc-lo');
  });

  it('khoá ký được giữ lại — đăng nhập lần hai không tải lại', async () => {
    const ms = fakeMicrosoft({});
    for (let i = 0; i < 2; i++) await ms.identity.complete({ code: 'c', state: (await ms.begin()).state });
    expect(ms.keysFetched()).toBe(1);
  });
});
