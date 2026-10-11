import {
  AddNetworkRule,
  AppQueries,
  ApproveApp,
  AuthenticateApiKey,
  AuthorizeAdmin,
  AuthorizeAppIngress,
  CreateApp,
  GetAdminProfile,
  GrantAppRole,
  IssueAppSecret,
  ListOrgAppRoles,
  RemoveMemberFromOrg,
  RevokeAppRole,
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
  TenancyOrgMemberRemoval,
} from '../../modules/apps/infrastructure/adapters/index.ts';
import {
  adminAppsRoutes,
  adminMembersRoutes,
  adminMeRoutes,
  AppsAdminAuthorizer,
  AppsApiKeyAuthenticator,
  v1AppsRoutes,
} from '../../modules/apps/interface/index.ts';
import type { FindOrganization, FindOrgMemberships, RemoveOrgMember } from '../../modules/tenancy/application/index.ts';
import type { AdminAuthorizer, ApiKeyAuthenticator } from '../../shared/http/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module apps: adapter -> use case -> route. Ngoài route, apps còn cung cấp `apiKeyAuthenticator`
 * — cổng xác thực cho TOÀN BỘ bề mặt `/v1` — và `adminAuthorizer` — cổng kiểm quyền cho TOÀN BỘ
 * bề mặt `/admin` (ADR-0022), của mọi module. `grantAppRole` dùng chung cho CLI và màn Thành viên (ADR-0026).
 */
export function appsModule(
  container: Container,
  dependencies: { findOrganization: FindOrganization; findOrgMemberships: FindOrgMemberships; removeOrgMember: RemoveOrgMember },
): {
  definition: ModuleDefinition;
  apiKeyAuthenticator: ApiKeyAuthenticator;
  adminAuthorizer: AdminAuthorizer;
  appQueries: AppQueries;
  grantAppRole: GrantAppRole;
  /** Cho incoming webhook (ADR-0030): app gửi được + qua allowlist IP / Origin. */
  authorizeAppIngress: AuthorizeAppIngress;
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
  const grantAppRole = new GrantAppRole({ uow, outbox, clock, apps, roles, memberships });

  return {
    appQueries: queries,
    authorizeAppIngress: new AuthorizeAppIngress({ apps, networkRules }),
    adminAuthorizer: new AppsAdminAuthorizer({ authorizeAdmin: new AuthorizeAdmin({ apps, roles, memberships }) }),
    grantAppRole,
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
          adminMeRoutes({ getAdminProfile: new GetAdminProfile({ organizations, memberships }) }),
          adminMembersRoutes({
            listOrgAppRoles: new ListOrgAppRoles({ roles }),
            removeMemberFromOrg: new RemoveMemberFromOrg({
              uow,
              outbox,
              clock,
              members: new TenancyOrgMemberRemoval({ removeOrgMember: dependencies.removeOrgMember }),
              roles,
            }),
            grantAppRole,
            revokeAppRole: new RevokeAppRole({ uow, outbox, clock, apps, roles }),
          }),
        ],
        v1: [v1AppsRoutes({ queries })],
      },
    },
  };
}
