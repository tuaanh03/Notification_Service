import { FindUserByExternalId, ListUsers, UnsubscribeUserEmail, UpsertUser } from '../../modules/directory/application/index.ts';
import { DrizzleUserRepository, SubscriptionsUserEmail } from '../../modules/directory/infrastructure/adapters/index.ts';
import { adminUsersRoutes, v1UsersRoutes } from '../../modules/directory/interface/index.ts';
import type { FindUserEmail, SetUserEmail, UnsubscribeEmail } from '../../modules/subscriptions/application/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/** Ghép module directory. Trả `findUser` — cửa công khai cho notifications (GĐ 3) tra người nhận. */
export function directoryModule(
  container: Container,
  dependencies: { setUserEmail: SetUserEmail; findUserEmail: FindUserEmail; unsubscribeEmail: UnsubscribeEmail },
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
        admin: [adminUsersRoutes({ listUsers: new ListUsers({ users, emails }) })],
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
