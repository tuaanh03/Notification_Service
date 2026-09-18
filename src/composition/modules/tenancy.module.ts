import { CreateAccount, CreateOrganization, FindOrganization } from '../../modules/tenancy/application/index.ts';
import { DrizzleAccountRepository, DrizzleOrganizationRepository } from '../../modules/tenancy/infrastructure/adapters/index.ts';
import { adminTenancyRoutes } from '../../modules/tenancy/interface/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module tenancy. Trả thêm `findOrganization` — cửa công khai cho module khác (apps) dùng qua adapter. */
export function tenancyModule(container: Container): { definition: ModuleDefinition; findOrganization: FindOrganization } {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;

  const accounts = new DrizzleAccountRepository({ transactions });
  const organizations = new DrizzleOrganizationRepository({ transactions });
  const findOrganization = new FindOrganization({ organizations });

  return {
    findOrganization,
    definition: {
      name: 'tenancy',
      http: {
        admin: [
          adminTenancyRoutes({
            createAccount: new CreateAccount({ uow, outbox, clock, accounts }),
            createOrganization: new CreateOrganization({ uow, outbox, clock, accounts, organizations }),
            findOrganization,
          }),
        ],
      },
    },
  };
}
