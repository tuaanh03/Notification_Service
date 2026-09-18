import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId, type Clock, type UserId } from '../../../../shared/kernel/index.ts';
import { toEmailSubscriptionDto, type EmailSubscriptionDto } from '../dto.ts';
import { SUBSCRIPTION_AGGREGATE, SUBSCRIPTION_EVENTS } from '../events.ts';
import type { SubscriptionRepository } from '../ports/index.ts';

/**
 * User ngắt hẳn email (L0 `unsubscribed` — chặn cả tin mandatory). Gọi lại là no-op; địa chỉ `invalid`
 * giữ nguyên `invalid` (xem `Subscription.unsubscribe`).
 */
export class UnsubscribeEmail {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; subscriptions: SubscriptionRepository };

  constructor(deps: UnsubscribeEmail['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; userId: UserId }, ctx: CommandContext): Promise<EmailSubscriptionDto> {
    const { uow, outbox, clock, subscriptions } = this.deps;
    return uow.run(async () => {
      const current = await subscriptions.findByUser(input.appId, input.userId, 'email');
      if (!current) throw new NotFoundError('email subscription of user', input.userId);
      if (current.unsubscribe(clock.now())) {
        await subscriptions.update(current);
        await outbox.append([
          {
            aggregateType: SUBSCRIPTION_AGGREGATE,
            aggregateId: current.id,
            eventType: SUBSCRIPTION_EVENTS.unsubscribed,
            payload: audited(ctx, { userId: input.userId, before: { status: 'active' }, after: { status: 'unsubscribed' } }),
          },
        ]);
      }
      return toEmailSubscriptionDto(current);
    });
  }
}
