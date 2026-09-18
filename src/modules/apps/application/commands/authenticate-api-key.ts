import { AuthenticationError, PermissionDeniedError } from '../../../../shared/kernel/index.ts';
import { checkNetworkAccess } from '../../domain/rules/network-access.ts';
import type { AuthenticatedApp } from '../dto.ts';
import type { ApiKeyService, AppRepository, AppSecretRepository, NetworkRuleRepository } from '../ports/index.ts';

/**
 * Cổng xác thực của `/v1/*`: API key -> app đang active -> qua allowlist IP / Origin.
 *
 * Mọi kiểu key sai (sai định dạng, không tồn tại, đã thu hồi, sai bí mật) trả CÙNG một lỗi — không
 * cho kẻ dò key biết mình sai ở bước nào. Lỗi 403 (app không active, IP lạ) chỉ xảy ra SAU khi key
 * đã đúng, nên không lộ gì cho người không có key.
 */
export class AuthenticateApiKey {
  private readonly deps: {
    apps: AppRepository;
    secrets: AppSecretRepository;
    networkRules: NetworkRuleRepository;
    apiKeys: ApiKeyService;
  };

  constructor(deps: AuthenticateApiKey['deps']) {
    this.deps = deps;
  }

  async execute(input: { apiKey: string | null; ip: string; origin: string | null }): Promise<AuthenticatedApp> {
    const { apps, secrets, networkRules, apiKeys } = this.deps;
    if (!input.apiKey) {
      throw new AuthenticationError('API_KEY_REQUIRED', 'missing API key: send Authorization: Bearer <api key>');
    }
    const invalid = new AuthenticationError('INVALID_API_KEY', 'invalid API key');

    const parsed = apiKeys.parse(input.apiKey);
    if (!parsed) throw invalid;
    const secret = await secrets.findById(parsed.secretId);
    if (!secret || secret.status !== 'active' || !apiKeys.verify(input.apiKey, secret.secretHash)) throw invalid;
    const app = await apps.findById(secret.appId);
    if (!app) throw invalid;

    if (!app.canSend) throw new PermissionDeniedError('APP_NOT_ACTIVE', `app ${app.slug} is ${app.status}`);
    const access = checkNetworkAccess(await networkRules.listByApp(app.id), { ip: input.ip, origin: input.origin });
    if (!access.allowed) {
      throw new PermissionDeniedError(access.reason, `request is not allowed by the network rules of app ${app.slug}`);
    }

    return {
      appId: app.id,
      orgId: app.orgId,
      accountId: app.accountId,
      slug: app.slug,
      grantedChannels: app.grantedChannels,
      rateLimitPerMinute: app.rateLimitPerMinute,
      maxRecipientsPerEvent: app.maxRecipientsPerEvent,
    };
  }
}
