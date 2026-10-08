import {
  AddNetworkRule,
  AppQueries,
  ApproveApp,
  AuthenticateApiKey,
  AuthorizeAdmin,
  CreateApp,
  GetAdminProfile,
  GrantAppRole,
  IssueAppSecret,
  RemoveNetworkRule,
  RevokeAppSecret,
  TransitionApp,
} from '../../modules/apps/application/index.ts';
import {
  CryptoApiKeyService,
  DrizzleAdminAppRoleRepository,
  DrizzleAppRepository,
  DrizzleAppSecretRepository,
  DrizzleNetworkRuleRepository,
  TenancyMembershipLookup,
  TenancyOrganizationLookup,
} from '../../modules/apps/infrastructure/adapters/index.ts';
import { adminAppsRoutes, adminMeRoutes, AppsAdminAuthorizer, AppsApiKeyAuthenticator, v1AppsRoutes } from '../../modules/apps/interface/index.ts';
import type { FindOrganization, FindOrgMemberships } from '../../modules/tenancy/application/index.ts';
import type { AdminAuthorizer, ApiKeyAuthenticator } from '../../shared/http/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module apps: adapter -> use case -> route. Ngoài route, apps còn cung cấp `apiKeyAuthenticator`
 * — cổng xác thực cho TOÀN BỘ bề mặt `/v1` — và `adminAuthorizer` — cổng kiểm quyền cho TOÀN BỘ
 * bề mặt `/admin` (ADR-0022), của mọi module. `grantAppRole` chỉ cho CLI.
 */
export function appsModule(
  container: Container,
  dependencies: { findOrganization: FindOrganization; findOrgMemberships: FindOrgMemberships },
): {
  definition: ModuleDefinition;
  apiKeyAuthenticator: ApiKeyAuthenticator;
  adminAuthorizer: AdminAuthorizer;
  appQueries: AppQueries;
  grantAppRole: GrantAppRole;
} {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;

  const apps = new DrizzleAppRepository({ transactions });
  const secrets = new DrizzleAppSecretRepository({ transactions });
  const networkRules = new DrizzleNetworkRuleRepository({ transactions });
  const apiKeys = new CryptoApiKeyService();
  const organizations = new TenancyOrganizationLookup({ findOrganization: dependencies.findOrganization });
  const queries = new AppQueries({ apps, secrets, networkRules });
  const roles = new DrizzleAdminAppRoleRepository({ transactions });
  const memberships = new TenancyMembershipLookup({ memberships: dependencies.findOrgMemberships });

  return {
    appQueries: queries,
    adminAuthorizer: new AppsAdminAuthorizer({ authorizeAdmin: new AuthorizeAdmin({ apps, roles, memberships }) }),
    grantAppRole: new GrantAppRole({ uow, outbox, clock, apps, roles, memberships }),
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
          adminMeRoutes({ getAdminProfile: new GetAdminProfile({ organizations }) }),
        ],
        v1: [v1AppsRoutes({ queries })],
      },
    },
  };
}
