import { FindUserEmail, SetUserEmail, UnsubscribeEmail } from '../../modules/subscriptions/application/index.ts';
import {
  DrizzleSubscriptionRepository,
  RandomManageTokenGenerator,
} from '../../modules/subscriptions/infrastructure/adapters/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Ghép module subscriptions. GĐ 1 chưa có route riêng — email của user đi qua `/v1/users` (directory).
 * Trả các use case công khai để module khác dùng qua adapter.
 */
export function subscriptionsModule(container: Container): {
  definition: ModuleDefinition;
  setUserEmail: SetUserEmail;
  findUserEmail: FindUserEmail;
  unsubscribeEmail: UnsubscribeEmail;
} {
  const { uow, outbox, clock } = container.ports;
  const subscriptions = new DrizzleSubscriptionRepository({ transactions: container.infra.transactions });

  return {
    definition: { name: 'subscriptions' },
    setUserEmail: new SetUserEmail({ uow, outbox, clock, subscriptions, tokens: new RandomManageTokenGenerator() }),
    findUserEmail: new FindUserEmail({ subscriptions }),
    unsubscribeEmail: new UnsubscribeEmail({ uow, outbox, clock, subscriptions }),
  };
}
