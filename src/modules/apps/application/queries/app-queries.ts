import type { AppId, OrgId } from '../../../../shared/kernel/index.ts';
import { requireApp } from '../commands/shared.ts';
import { toAppDto, toAppSecretDto, toNetworkRuleDto, type AppDto, type AppSecretDto, type NetworkRuleDto } from '../dto.ts';
import type { AppRepository, AppSecretRepository, NetworkRuleRepository } from '../ports/index.ts';

/** Truy vấn đọc cho console. Không qua transaction, không ghi gì. */
export class AppQueries {
  private readonly deps: { apps: AppRepository; secrets: AppSecretRepository; networkRules: NetworkRuleRepository };

  constructor(deps: AppQueries['deps']) {
    this.deps = deps;
  }

  async get(appId: AppId): Promise<AppDto> {
    return toAppDto(await requireApp(this.deps.apps, appId));
  }

  async listByOrg(orgId: OrgId): Promise<AppDto[]> {
    return (await this.deps.apps.listByOrg(orgId)).map(toAppDto);
  }

  async listSecrets(appId: AppId): Promise<AppSecretDto[]> {
    await requireApp(this.deps.apps, appId);
    return (await this.deps.secrets.listByApp(appId)).map(toAppSecretDto);
  }

  async listNetworkRules(appId: AppId): Promise<NetworkRuleDto[]> {
    await requireApp(this.deps.apps, appId);
    return (await this.deps.networkRules.listByApp(appId)).map(toNetworkRuleDto);
  }
}
