import { describe, expect, it } from 'vitest';
import type { Logger } from '../../src/shared/observability/logger.ts';
import {
  AuthenticateApiKey,
  type AppRepository,
  type AppSecretRepository,
  type NetworkRuleRepository,
} from '../../src/modules/apps/application/index.ts';
import { App } from '../../src/modules/apps/domain/entities/app.ts';
import { AppNetworkRule } from '../../src/modules/apps/domain/entities/app-network-rule.ts';
import { AppSecret } from '../../src/modules/apps/domain/entities/app-secret.ts';
import { checkNetworkAccess } from '../../src/modules/apps/domain/rules/network-access.ts';
import { CryptoApiKeyService } from '../../src/modules/apps/infrastructure/adapters/crypto-api-key-service.ts';
import {
  AccountId,
  AppId,
  AppSecretId,
  AuthenticationError,
  OrgId,
  PermissionDeniedError,
  ValidationError,
  type AppStatus,
} from '../../src/shared/kernel/index.ts';

const AT = new Date('2026-09-18T00:00:00.000Z');
const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));

function app(status: AppStatus = 'active'): App {
  return new App({
    id: AppId.create(),
    orgId: OrgId.create(),
    accountId: AccountId.create(),
    slug: 'shop',
    name: 'Shop',
    namespace: 'shop',
    status,
    grantedChannels: ['email'],
    createdAt: AT,
  });
}

describe('App.register — app tự phục vụ (ADR-0023)', () => {
  it('tạo xong là active, cấp sẵn email, gửi được ngay', () => {
    const a = App.register({
      id: AppId.create(),
      orgId: OrgId.create(),
      accountId: AccountId.create(),
      slug: 'self',
      name: 'Self',
      namespace: 'self',
      createdAt: AT,
    });
    expect(a.status).toBe('active');
    expect(a.grantedChannels).toEqual(['email']);
    expect(a.canSend).toBe(true);
  });
});

describe('App.approve — duyệt kèm quyền cấp (app cũ đang chờ duyệt)', () => {
  it('pending_approval -> active, ghi quyền cấp (khử trùng kênh)', () => {
    const a = app('pending_approval');
    a.approve({ grantedChannels: ['email', 'email', 'in_app'], rateLimitPerMinute: 120, maxRecipientsPerEvent: 500 }, AT);
    expect(a.status).toBe('active');
    expect(a.grantedChannels).toEqual(['email', 'in_app']);
    expect(a.rateLimitPerMinute).toBe(120);
  });

  it('không cấp kênh nào / hạn mức không hợp lệ -> ValidationError gom đủ lỗi, trạng thái không đổi', () => {
    const a = app('pending_approval');
    try {
      a.approve({ grantedChannels: [], rateLimitPerMinute: 0, maxRecipientsPerEvent: 1.5 }, AT);
      expect.unreachable();
    } catch (err) {
      expect((err as ValidationError).issues.map((i) => i.code)).toEqual([
        'GRANT_CHANNELS_REQUIRED',
        'GRANT_RATE_LIMIT_INVALID',
        'GRANT_MAX_RECIPIENTS_INVALID',
      ]);
    }
    expect(a.status).toBe('pending_approval');
  });

  it('app đã thu hồi không nhận secret mới', () => {
    expect(() => app('revoked').assertAcceptsNewSecret()).toThrow(ValidationError);
  });
});

describe('allowlist IP của /v1 và /hooks', () => {
  const rules = [{ kind: 'ip' as const, value: '10.0.0.5' }];

  it('chưa khai IP nào -> không giới hạn', () => {
    expect(checkNetworkAccess([], { ip: '1.2.3.4' })).toEqual({ allowed: true });
  });

  it('IP phải nằm trong danh sách; dạng IPv4-mapped IPv6 của Node được coi là một', () => {
    expect(checkNetworkAccess(rules, { ip: '::ffff:10.0.0.5' })).toEqual({ allowed: true });
    expect(checkNetworkAccess(rules, { ip: '10.0.0.6' })).toEqual({ allowed: false, reason: 'IP_NOT_ALLOWED' });
  });
});

describe('AppSecret — tên khoá và trần khoá đang hoạt động', () => {
  const base = { id: AppSecretId.create(), appId: AppId.create(), secretHash: 'h', hint: 'ews_x', createdAt: AT };

  it('tên được cắt khoảng trắng; rỗng -> null; quá 100 ký tự -> SECRET_NAME_TOO_LONG', () => {
    expect(new AppSecret({ ...base, name: '  job sync ' }).name).toBe('job sync');
    expect(new AppSecret({ ...base, name: '   ' }).name).toBeNull();
    expect(new AppSecret(base).name).toBeNull();
    expect(() => new AppSecret({ ...base, name: 'x'.repeat(101) })).toThrow(ValidationError);
  });

  it('đủ trần -> ACTIVE_SECRET_LIMIT; dưới trần -> qua', () => {
    expect(() => AppSecret.assertCanAddActive(19, 20)).not.toThrow();
    expect(() => AppSecret.assertCanAddActive(20, 20)).toThrow(ValidationError);
  });
});

describe('CryptoApiKeyService', () => {
  const service = new CryptoApiKeyService();

  it('key tự mang secret id; hash khớp đúng key đó; hint không chứa bí mật', () => {
    const issued = service.issue();
    expect(issued.apiKey).toMatch(/^ews_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    expect(service.parse(issued.apiKey)).toEqual({ secretId: issued.secretId });
    expect(service.verify(issued.apiKey, issued.secretHash)).toBe(true);
    expect(issued.secretHash).not.toContain(issued.apiKey);
    const secretPart = issued.apiKey.slice('ews_'.length + 32 + 1); // base64url có thể chứa '_' -> không split
    expect(issued.hint).not.toContain(secretPart); // hint chỉ lộ 4 ký tự cuối, không lộ bí mật
    expect(issued.hint).toMatch(/^ews_[0-9a-f]{8}….{4}$/);
  });

  it('sửa một ký tự của key -> verify sai; sai định dạng -> parse null', () => {
    const issued = service.issue();
    const tampered = issued.apiKey.slice(0, -1) + (issued.apiKey.endsWith('A') ? 'B' : 'A');
    expect(service.verify(tampered, issued.secretHash)).toBe(false);
    expect(service.parse('nsk_live_whatever')).toBeNull();
  });
});

// Use case test bằng FAKE của port — không DB. Đây cũng là bằng chứng DI theo interface dùng được thật.
describe('AuthenticateApiKey (use case, port giả)', () => {
  const keys = new CryptoApiKeyService();

  function setup(
    opts: { appStatus?: AppStatus; secretStatus?: 'active' | 'revoked'; rules?: AppNetworkRule[]; lastUsedAt?: Date } = {},
  ) {
    const theApp = app(opts.appStatus ?? 'active');
    const issued = keys.issue();
    const secret = new AppSecret({
      id: issued.secretId,
      appId: theApp.id,
      secretHash: issued.secretHash,
      hint: issued.hint,
      status: opts.secretStatus ?? 'active',
      lastUsedAt: opts.lastUsedAt,
      createdAt: AT,
    });
    const apps = { findById: async (id: AppId) => (id === theApp.id ? theApp : null) } as unknown as AppRepository;
    const touched: Date[] = [];
    const secrets = {
      findById: async (id: string) => (id === secret.id ? secret : null),
      touchLastUsed: async (_id: string, at: Date) => void touched.push(at),
    } as unknown as AppSecretRepository;
    const networkRules = { listByApp: async () => opts.rules ?? [] } as unknown as NetworkRuleRepository;
    const clock = { now: () => AT };
    const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return logger; } } as unknown as Logger;
    const useCase = new AuthenticateApiKey({ apps, secrets, networkRules, apiKeys: keys, clock, logger });
    return { useCase, apiKey: issued.apiKey, theApp, touched };
  }
  const call = (useCase: AuthenticateApiKey, apiKey: string | null, ip = '10.0.0.1') =>
    useCase.execute({ apiKey, ip });

  it('key đúng, app active -> trả caller đầy đủ, ghi "dùng lần cuối"', async () => {
    const { useCase, apiKey, theApp, touched } = setup();
    expect(await call(useCase, apiKey)).toMatchObject({ appId: theApp.id, slug: 'shop', grantedChannels: ['email'] });
    expect(touched).toEqual([AT]);
  });

  it('khoá vừa dùng chưa tới 5 phút -> không ghi lại "dùng lần cuối"', async () => {
    const { useCase, apiKey, touched } = setup({ lastUsedAt: new Date(AT.getTime() - 60_000) });
    await call(useCase, apiKey);
    expect(touched).toEqual([]);
  });

  it('key sai -> không ghi "dùng lần cuối"', async () => {
    const { useCase, touched } = setup();
    await call(useCase, 'garbage').catch(() => undefined);
    expect(touched).toEqual([]);
  });

  it('thiếu key -> 401 API_KEY_REQUIRED', async () => {
    const { useCase } = setup();
    expect(await codeOf(call(useCase, null))).toBe('API_KEY_REQUIRED');
  });

  // Mọi kiểu key sai trả CÙNG một mã — không cho kẻ dò key biết sai ở bước nào.
  it.each([
    ['sai định dạng', () => 'garbage'],
    ['secret id không tồn tại', () => keys.issue().apiKey],
  ])('key %s -> INVALID_API_KEY', async (_name, makeKey) => {
    const { useCase } = setup();
    const err = await call(useCase, makeKey()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).code).toBe('INVALID_API_KEY');
  });

  it('key đã thu hồi -> INVALID_API_KEY (y như key không tồn tại)', async () => {
    const { useCase, apiKey } = setup({ secretStatus: 'revoked' });
    expect(await codeOf(call(useCase, apiKey))).toBe('INVALID_API_KEY');
  });

  it('key đúng nhưng app bị đình chỉ -> 403 APP_NOT_ACTIVE', async () => {
    const { useCase, apiKey } = setup({ appStatus: 'suspended' });
    const err = await call(useCase, apiKey).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect((err as PermissionDeniedError).code).toBe('APP_NOT_ACTIVE');
  });

  it('key đúng nhưng IP ngoài allowlist -> 403 IP_NOT_ALLOWED', async () => {
    const appId = AppId.create();
    const { useCase, apiKey } = setup({ rules: [new AppNetworkRule({ appId, kind: 'ip', value: '10.9.9.9' })] });
    expect(await codeOf(call(useCase, apiKey, '10.0.0.1'))).toBe('IP_NOT_ALLOWED');
  });
});
