import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AppId, Clock } from '../../../../shared/kernel/index.ts';
import type { AppGrant } from '../../domain/entities/app.ts';
import { toAppDto, type AppDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository } from '../ports/index.ts';
import { requireApp } from './shared.ts';

/** `pending_approval -> active`, kèm quyền cấp (kênh, hạn mức). Audit ghi cả quyền trước / sau. */
export class ApproveApp {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: ApproveApp['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; grant: AppGrant }, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = {
        status: app.status,
        grantedChannels: [...app.grantedChannels],
        rateLimitPerMinute: app.rateLimitPerMinute,
        maxRecipientsPerEvent: app.maxRecipientsPerEvent,
      };
      app.approve(input.grant, clock.now());
      await apps.update(app, before.status);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.approved,
          payload: audited(ctx, {
            before,
            after: {
              status: app.status,
              grantedChannels: [...app.grantedChannels],
              rateLimitPerMinute: app.rateLimitPerMinute,
              maxRecipientsPerEvent: app.maxRecipientsPerEvent,
            },
          }),
        },
      ]);
      return toAppDto(app);
    });
  }
}
