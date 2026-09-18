import {
  audited,
  type CommandContext,
  type EventOutbox,
  type IntegrationEvent,
  type UnitOfWork,
} from '../../../../shared/application/index.ts';
import {
  ConflictError,
  normalizeEmail,
  SubscriptionId,
  type AppId,
  type Clock,
  type UserId,
} from '../../../../shared/kernel/index.ts';
import { Subscription } from '../../domain/entities/subscription.ts';
import { toEmailSubscriptionDto, type EmailSubscriptionDto } from '../dto.ts';
import { SUBSCRIPTION_AGGREGATE, SUBSCRIPTION_EVENTS } from '../events.ts';
import type { ManageTokenGenerator, SubscriptionRepository } from '../ports/index.ts';

/**
 * Đặt email cho một user (MVP: mỗi user một email mỗi app). Luật (implementation_plan.md §5):
 *   chưa có email            -> tạo, `active`
 *   cùng địa chỉ, `active`   -> không đổi gì
 *   cùng địa chỉ, user đã tự ngắt (`unsubscribed`) -> bật lại, evidence = app gọi
 *   cùng địa chỉ, `invalid`  -> GIỮ `invalid`: app service không được tự bật lại địa chỉ đã bounce
 *   địa chỉ khác             -> `changeAddress` (xoá invalid, GIỮ unsubscribed, xoay token)
 *   địa chỉ đã thuộc user khác trong app -> 409 `EMAIL_TAKEN`
 *
 * Caller (directory) phải khoá dòng user trước khi gọi — hai request đặt email song song cho cùng
 * một user sẽ tạo ra hai subscription nếu không tuần tự hoá (ADR-0009).
 */
export class SetUserEmail {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    subscriptions: SubscriptionRepository;
    tokens: ManageTokenGenerator;
  };

  constructor(deps: SetUserEmail['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; userId: UserId; email: string },
    ctx: CommandContext,
  ): Promise<EmailSubscriptionDto> {
    const { uow, outbox, clock, subscriptions, tokens } = this.deps;
    const address = normalizeEmail(input.email);

    return uow.run(async () => {
      const now = clock.now();
      const owner = await subscriptions.findByValue(input.appId, 'email', address);
      if (owner && owner.userId !== input.userId) throw emailTaken();

      const current = await subscriptions.findByUser(input.appId, input.userId, 'email');
      const event = (eventType: string, change: Record<string, unknown>, sub: Subscription): IntegrationEvent => ({
        aggregateType: SUBSCRIPTION_AGGREGATE,
        aggregateId: sub.id,
        eventType,
        payload: audited(ctx, { userId: input.userId, channel: 'email', ...change }),
      });

      if (!current) {
        const created = new Subscription({
          id: SubscriptionId.create(),
          userId: input.userId,
          appId: input.appId,
          channel: 'email',
          value: address,
          manageToken: tokens.next(),
          createdAt: now,
        });
        await subscriptions.insert(created);
        await outbox.append([event(SUBSCRIPTION_EVENTS.created, { after: { address, status: 'active' } }, created)]);
        return toEmailSubscriptionDto(created);
      }

      if (current.value !== address) {
        const before = { address: current.value, status: current.status };
        current.changeAddress(address, tokens.next(), now);
        await subscriptions.update(current);
        await outbox.append([
          event(SUBSCRIPTION_EVENTS.addressChanged, { before, after: { address, status: current.status } }, current),
        ]);
        return toEmailSubscriptionDto(current);
      }

      if (current.status === 'unsubscribed' && current.suppressedReason === 'user_unsubscribe') {
        current.resubscribe(`app:${input.appId}`, now);
        await subscriptions.update(current);
        await outbox.append([
          event(SUBSCRIPTION_EVENTS.resubscribed, { before: { status: 'unsubscribed' }, after: { status: 'active' } }, current),
        ]);
      }
      // `active`: không đổi. `invalid`: cố ý giữ nguyên — trả trạng thái để app service biết.
      return toEmailSubscriptionDto(current);
    });
  }
}

export function emailTaken(): ConflictError {
  return new ConflictError('EMAIL_TAKEN', 'this email address already belongs to another user of this app');
}
