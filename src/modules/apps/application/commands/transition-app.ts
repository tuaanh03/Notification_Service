import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AppId, Clock } from '../../../../shared/kernel/index.ts';
import type { AppTransitionEvent } from '../../domain/rules/app-transitions.ts';
import { toAppDto, type AppDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository } from '../ports/index.ts';
import { requireApp } from './shared.ts';

/** Mọi chuyển trạng thái không mang dữ liệu kèm. `approve` có command riêng vì kèm quyền cấp. */
export type SimpleAppTransition = Exclude<AppTransitionEvent, 'approve'>;

const EVENT_OF: Record<SimpleAppTransition, string> = {
  submit_for_review: APP_EVENTS.submittedForReview,
  reject: APP_EVENTS.rejected,
  suspend: APP_EVENTS.suspended,
  resume: APP_EVENTS.resumed,
  revoke: APP_EVENTS.revoked,
};

/**
 * Chuyển trạng thái app theo bảng APP_TRANSITIONS. Sai đường -> InvalidTransitionError (409).
 * Ghi có điều kiện theo trạng thái lúc đọc: hai admin bấm cùng lúc thì một người nhận 409.
 */
export class TransitionApp {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: TransitionApp['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; transition: SimpleAppTransition; reason?: string | undefined },
    ctx: CommandContext,
  ): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = app.status;
      app.apply(input.transition, clock.now());
      await apps.update(app, before);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: EVENT_OF[input.transition],
          payload: audited(ctx, { before: { status: before }, after: { status: app.status }, reason: input.reason ?? null }),
        },
      ]);
      return toAppDto(app);
    });
  }
}
