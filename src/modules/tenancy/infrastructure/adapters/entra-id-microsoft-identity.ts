import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { AuthenticationError, UpstreamError, type Clock } from '../../../../shared/kernel/index.ts';
import type { MicrosoftIdentity, MicrosoftProfile } from '../../application/ports/index.ts';
import type { LoginStateStore } from './redis-login-state-store.ts';

export interface EntraIdConfig {
  /** Directory (tenant) ID — GUID. Chỉ người trong tenant này đăng nhập được (single tenant). */
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Trang callback của console — phải khớp từng ký tự với bản đăng ký trên Entra ID. */
  redirectUri: string;
  timeoutMs: number;
}

type Fetch = typeof fetch;

const AUTHORITY = 'https://login.microsoftonline.com';
const SCOPE = 'openid profile email';
/** Một lượt đăng nhập phải xong trong 10 phút — đủ cho cả bước MFA, đủ ngắn để `state` rò ra cũng vô dụng. */
const LOGIN_TTL_MS = 10 * 60 * 1000;
/** Lệch đồng hồ cho phép khi kiểm `exp` / `nbf`. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Khoá ký của Microsoft xoay vòng định kỳ: giữ một ngày, gặp `kid` lạ thì tải lại (tối đa 5 phút một lần). */
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;
const KEYS_REFRESH_MIN_MS = 5 * 60 * 1000;

interface PendingLogin {
  nonce: string;
  verifier: string;
}

/**
 * OpenID Connect với Entra ID: Authorization Code + PKCE, client là BACKEND (giữ secret) — ADR-0021.
 *
 * Kiểm `id_token` đủ bước dù token đi thẳng từ Microsoft qua TLS: chữ ký RS256 theo khoá công khai
 * của tenant, `iss`, `aud`, `tid`, `exp` / `nbf`, `nonce`. Không thêm thư viện JWT — `node:crypto`
 * đủ cho đúng một thuật toán.
 *
 * Không log, không đưa vào message: `code`, `client_secret`, token. Lỗi chỉ mang mã lỗi OAuth.
 */
export class EntraIdMicrosoftIdentity implements MicrosoftIdentity {
  readonly configured = true;
  private readonly config: EntraIdConfig;
  private readonly states: LoginStateStore;
  private readonly clock: Clock;
  private readonly fetch: Fetch;
  private keys: { byKid: Map<string, KeyObject>; fetchedAt: number } | null = null;

  constructor(deps: { config: EntraIdConfig; states: LoginStateStore; clock: Clock; fetch?: Fetch | undefined }) {
    this.config = deps.config;
    this.states = deps.states;
    this.clock = deps.clock;
    this.fetch = deps.fetch ?? fetch;
  }

  private get tenantBase(): string {
    return `${AUTHORITY}/${this.config.tenantId}`;
  }

  async begin(): Promise<{ authorizeUrl: string; state: string }> {
    const state = randomToken();
    const pending: PendingLogin = { nonce: randomToken(), verifier: randomToken() };
    await this.states.save(state, JSON.stringify(pending), LOGIN_TTL_MS);

    const url = new URL(`${this.tenantBase}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      response_mode: 'query',
      scope: SCOPE,
      state,
      nonce: pending.nonce,
      code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      // Cho chọn tài khoản thay vì tự vào bằng tài khoản Microsoft đang mở sẵn trên trình duyệt.
      prompt: 'select_account',
    }).toString();
    return { authorizeUrl: url.toString(), state };
  }

  async complete(input: { code: string; state: string }): Promise<MicrosoftProfile> {
    const raw = await this.states.take(input.state);
    if (raw === null) throw new AuthenticationError('M365_STATE_INVALID', 'sign-in attempt is unknown, expired or already used');
    const pending = JSON.parse(raw) as PendingLogin;

    const idToken = await this.redeem(input.code, pending.verifier);
    const claims = await this.verifyIdToken(idToken);
    if (claims.nonce !== pending.nonce) throw invalidToken('nonce mismatch');
    if (typeof claims.oid !== 'string' || claims.oid === '') throw invalidToken('missing oid');

    const email = [claims.email, claims.preferred_username].find((v): v is string => typeof v === 'string' && v.includes('@'));
    return { oid: claims.oid, email: email ?? null, name: typeof claims.name === 'string' ? claims.name : null };
  }

  /** Đổi `code` lấy `id_token` ở token endpoint, kèm secret + `code_verifier` (PKCE). */
  private async redeem(code: string, verifier: string): Promise<string> {
    const response = await this.call(`${this.tenantBase}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: verifier,
        scope: SCOPE,
      }).toString(),
    });
    const body = (await response.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
    if (!response.ok) {
      const error = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
      // `invalid_grant`: mã đã dùng / hết hạn / không khớp verifier — lỗi của lượt đăng nhập, bấm lại là xong.
      // Mã khác (`invalid_client` = secret sai / hết hạn…) là lỗi cấu hình phía EWS -> 502 để người trực thấy.
      if (error === 'invalid_grant') throw new AuthenticationError('M365_SIGN_IN_FAILED', `token endpoint rejected the code: ${error}`);
      throw new UpstreamError('M365_PROVIDER_ERROR', `token endpoint returned ${response.status}: ${error}`);
    }
    if (typeof body?.id_token !== 'string') throw new UpstreamError('M365_PROVIDER_ERROR', 'token endpoint returned no id_token');
    return body.id_token;
  }

  private async verifyIdToken(token: string): Promise<IdTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw invalidToken('malformed');
    const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
    const header = decodeJson(rawHeader) as { alg?: unknown; kid?: unknown } | null;
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw invalidToken('unsupported header');

    const key = await this.signingKey(header.kid);
    const signed = verify('RSA-SHA256', Buffer.from(`${rawHeader}.${rawPayload}`), key, Buffer.from(rawSignature, 'base64url'));
    if (!signed) throw invalidToken('bad signature');

    const claims = decodeJson(rawPayload) as IdTokenClaims | null;
    if (claims === null) throw invalidToken('malformed payload');
    const tenant = this.config.tenantId.toLowerCase();
    if (claims.iss !== `${AUTHORITY}/${tenant}/v2.0`) throw invalidToken('issuer mismatch');
    if (claims.aud !== this.config.clientId) throw invalidToken('audience mismatch');
    if (typeof claims.tid !== 'string' || claims.tid.toLowerCase() !== tenant) throw invalidToken('tenant mismatch');
    const now = this.clock.now().getTime();
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - CLOCK_SKEW_MS) throw invalidToken('expired');
    if (typeof claims.nbf === 'number' && claims.nbf * 1000 > now + CLOCK_SKEW_MS) throw invalidToken('not yet valid');
    return claims;
  }

  private async signingKey(kid: string): Promise<KeyObject> {
    const now = this.clock.now().getTime();
    const stale = this.keys === null || now - this.keys.fetchedAt > KEYS_TTL_MS;
    const unknownKid = this.keys !== null && !this.keys.byKid.has(kid) && now - this.keys.fetchedAt > KEYS_REFRESH_MIN_MS;
    if (stale || unknownKid) this.keys = { byKid: await this.fetchKeys(), fetchedAt: now };
    const key = this.keys?.byKid.get(kid);
    if (key === undefined) throw invalidToken('unknown signing key');
    return key;
  }

  private async fetchKeys(): Promise<Map<string, KeyObject>> {
    const response = await this.call(`${this.tenantBase}/discovery/v2.0/keys`, { method: 'GET' });
    if (!response.ok) throw new UpstreamError('M365_PROVIDER_ERROR', `signing keys endpoint returned ${response.status}`);
    const body = (await response.json().catch(() => null)) as { keys?: (JsonWebKey & { kid?: unknown })[] } | null;
    const byKid = new Map<string, KeyObject>();
    for (const jwk of body?.keys ?? []) {
      if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue;
      byKid.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    return byKid;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new UpstreamError(
        'M365_PROVIDER_ERROR',
        timedOut ? `Microsoft did not answer within ${this.config.timeoutMs} ms` : 'Microsoft sign-in endpoint unreachable',
      );
    }
  }
}

interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  tid?: unknown;
  exp?: unknown;
  nbf?: unknown;
  nonce?: unknown;
  oid?: unknown;
  email?: unknown;
  preferred_username?: unknown;
  name?: unknown;
}

const randomToken = () => randomBytes(32).toString('base64url');
const invalidToken = (reason: string) => new AuthenticationError('M365_TOKEN_INVALID', `id token rejected: ${reason}`);

function decodeJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Chưa cấu hình `M365_*`. Application kiểm `configured` trước nên hai hàm dưới không được gọi tới. */
export class DisabledMicrosoftIdentity implements MicrosoftIdentity {
  readonly configured = false;

  begin(): Promise<never> {
    return Promise.reject(new UpstreamError('M365_NOT_CONFIGURED', 'Microsoft 365 sign-in is not configured', 503));
  }

  complete(): Promise<never> {
    return Promise.reject(new UpstreamError('M365_NOT_CONFIGURED', 'Microsoft 365 sign-in is not configured', 503));
  }
}
