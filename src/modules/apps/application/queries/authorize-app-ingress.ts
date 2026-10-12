import { NotFoundError, PermissionDeniedError, type AppId, type Channel } from '../../../../shared/kernel/index.ts';
import { checkNetworkAccess } from '../../domain/rules/network-access.ts';
import type { AppRepository, NetworkRuleRepository } from '../ports/index.ts';

/**
 * Cửa CÔNG KHAI cho module khác (incoming webhook — ADR-0030): một lời gọi vào thay mặt app có được
 * nhận không. Cùng luật với `/v1` (`AuthenticateApiKey`): app phải gửi được + qua allowlist IP
 * — chỉ khác là ai đó đã xác thực bằng token của hook thay vì API key.
 */
export class AuthorizeAppIngress {
  private readonly deps: { apps: AppRepository; networkRules: NetworkRuleRepository };

  constructor(deps: AuthorizeAppIngress['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; ip: string }): Promise<{ appId: AppId; slug: string; grantedChannels: readonly Channel[] }> {
    const app = await this.deps.apps.findById(input.appId);
    if (!app) throw new NotFoundError('app', input.appId);
    if (!app.canSend) throw new PermissionDeniedError('APP_NOT_ACTIVE', `app ${app.slug} is ${app.status}`);
    const access = checkNetworkAccess(await this.deps.networkRules.listByApp(app.id), { ip: input.ip });
    if (!access.allowed) {
      throw new PermissionDeniedError(access.reason, `request is not allowed by the network rules of app ${app.slug}`);
    }
    return { appId: app.id, slug: app.slug, grantedChannels: app.grantedChannels };
  }
}
