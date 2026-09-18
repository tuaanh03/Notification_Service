import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { ValidationError, type AppId, type Clock, type UserId } from '../../../../shared/kernel/index.ts';
import { toEmailSubscriptionDto, type EmailSubscriptionDto } from '../dto.ts';
import { SUBSCRIPTION_AGGREGATE, SUBSCRIPTION_EVENTS } from '../events.ts';
import type { SubscriptionRepository } from '../ports/index.ts';

/**
 * L1 — "tắt mọi email không bắt buộc" của một user trong một app. Tách hẳn khỏi `status` (L0): tin
 * mandatory vẫn tới. Không đổi gì thì không ghi, không phát event.
 */
export class SetOptedOutOptional {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; subscriptions: SubscriptionRepository };

  constructor(deps: SetOptedOutOptional['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; userId: UserId; optedOut: boolean },
    ctx: CommandContext,
  ): Promise<EmailSubscriptionDto> {
    const { uow, outbox, clock, subscriptions } = this.deps;
    return uow.run(async () => {
      const current = await subscriptions.findByUser(input.appId, input.userId, 'email');
      if (!current) {
        throw ValidationError.of('EMAIL_NOT_SET', 'user has no email yet: set it with PUT /v1/users/:externalId', 'optedOutOptional');
      }
      if (current.optedOutOptional === input.optedOut) return toEmailSubscriptionDto(current);

      if (input.optedOut) current.optOutOptional(clock.now());
      else current.optInOptional(clock.now());
      await subscriptions.update(current);
      await outbox.append([
        {
          aggregateType: SUBSCRIPTION_AGGREGATE,
          aggregateId: current.id,
          eventType: SUBSCRIPTION_EVENTS.optedOutOptionalChanged,
          payload: audited(ctx, {
            userId: input.userId,
            before: { optedOutOptional: !input.optedOut },
            after: { optedOutOptional: input.optedOut },
          }),
        },
      ]);
      return toEmailSubscriptionDto(current);
    });
  }
}
