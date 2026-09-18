import {
  AddNetworkRule,
  AppQueries,
  ApproveApp,
  AuthenticateApiKey,
  CreateApp,
  IssueAppSecret,
  RemoveNetworkRule,
  RevokeAppSecret,
  TransitionApp,
} from '../../modules/apps/application/index.ts';
import {
  CryptoApiKeyService,
  DrizzleAppRepository,
  DrizzleAppSecretRepository,
  DrizzleNetworkRuleRepository,
  TenancyOrganizationLookup,
} from '../../modules/apps/infrastructure/adapters/index.ts';
import { adminAppsRoutes, AppsApiKeyAuthenticator, v1AppsRoutes } from '../../modules/apps/interface/index.ts';
import type { FindOrganization } from '../../modules/tenancy/application/index.ts';
import type { ApiKeyAuthenticator } from '../../shared/http/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module apps: adapter -> use case -> route. Ngoài route, apps còn cung cấp `apiKeyAuthenticator`
 * — cổng xác thực cho TOÀN BỘ bề mặt `/v1`, của mọi module.
 */
export function appsModule(
  container: Container,
  dependencies: { findOrganization: FindOrganization },
): { definition: ModuleDefinition; apiKeyAuthenticator: ApiKeyAuthenticator; appQueries: AppQueries } {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;

  const apps = new DrizzleAppRepository({ transactions });
  const secrets = new DrizzleAppSecretRepository({ transactions });
  const networkRules = new DrizzleNetworkRuleRepository({ transactions });
  const apiKeys = new CryptoApiKeyService();
  const organizations = new TenancyOrganizationLookup({ findOrganization: dependencies.findOrganization });
  const queries = new AppQueries({ apps, secrets, networkRules });

  return {
    appQueries: queries,
    apiKeyAuthenticator: new AppsApiKeyAuthenticator({
      authenticateApiKey: new AuthenticateApiKey({ apps, secrets, networkRules, apiKeys }),
    }),
    definition: {
      name: 'apps',
      http: {
        admin: [
          adminAppsRoutes({
            createApp: new CreateApp({ uow, outbox, clock, apps, organizations }),
            transitionApp: new TransitionApp({ uow, outbox, clock, apps }),
            approveApp: new ApproveApp({ uow, outbox, clock, apps }),
            issueAppSecret: new IssueAppSecret({ uow, outbox, clock, apps, secrets, apiKeys }),
            revokeAppSecret: new RevokeAppSecret({ uow, outbox, clock, apps, secrets }),
            addNetworkRule: new AddNetworkRule({ uow, outbox, apps, networkRules }),
            removeNetworkRule: new RemoveNetworkRule({ uow, outbox, apps, networkRules }),
            queries,
          }),
        ],
        v1: [v1AppsRoutes({ queries })],
      },
    },
  };
}
