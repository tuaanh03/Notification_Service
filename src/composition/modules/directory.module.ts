import type { AppQueries } from '../../modules/apps/application/index.ts';
import { CreateUser, FindUserByExternalId, ListUsers, UnsubscribeUserEmail, UpsertUser } from '../../modules/directory/application/index.ts';
import { AppsAppOrgLookup, DrizzleUserRepository, SubscriptionsUserEmail } from '../../modules/directory/infrastructure/adapters/index.ts';
import { adminUsersRoutes, v1UsersRoutes } from '../../modules/directory/interface/index.ts';
import type { FindUserEmail, SetUserEmail, UnsubscribeEmail } from '../../modules/subscriptions/application/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module directory (cần apps: org của app khi thêm tay người nhận). Trả `findUser` — cửa công khai cho notifications (GĐ 3) tra người nhận. */
export function directoryModule(
  container: Container,
  dependencies: { setUserEmail: SetUserEmail; findUserEmail: FindUserEmail; unsubscribeEmail: UnsubscribeEmail; appQueries: AppQueries },
): { definition: ModuleDefinition; findUser: FindUserByExternalId } {
  const { uow, outbox, clock } = container.ports;
  const users = new DrizzleUserRepository({ transactions: container.infra.transactions });
  const emails = new SubscriptionsUserEmail(dependencies);
  const findUser = new FindUserByExternalId({ users, emails });

  return {
    findUser,
    definition: {
      name: 'directory',
      http: {
        admin: [
          adminUsersRoutes({
            listUsers: new ListUsers({ users, emails }),
            findUser,
            createUser: new CreateUser({ uow, outbox, clock, users, emails, apps: new AppsAppOrgLookup(dependencies) }),
          }),
        ],
        v1: [
          v1UsersRoutes({
            upsertUser: new UpsertUser({ uow, outbox, clock, users, emails }),
            findUser,
            unsubscribeUserEmail: new UnsubscribeUserEmail({ uow, users, emails }),
          }),
        ],
      },
    },
  };
}
