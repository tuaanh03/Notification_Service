import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { parseSendWindow, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { toAppDto, type AppDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository } from '../ports/index.ts';
import { requireApp } from './shared.ts';

export interface SetSendWindowInput {
  appId: AppId;
  /** null = gửi mọi lúc. */
  window: { days: number[]; start: string; end: string } | null;
  mandatoryBypass: boolean;
}

/**
 * Đặt khung giờ gửi của một app (ADR-0032) — người quản lý app (`app.manage`). Thư nhận ngoài khung
 * chờ tới lúc khung mở; thư đã nhận trước lúc đổi giữ giờ đã hẹn. Không đổi gì -> không ghi, không audit.
 */
export class SetSendWindow {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: SetSendWindow['deps']) {
    this.deps = deps;
  }

  async execute(input: SetSendWindowInput, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    const window = input.window === null ? null : parseSendWindow(input.window);
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = toAppDto(app);
      if (!app.setSendWindow(window, input.mandatoryBypass, clock.now())) return before;
      await apps.update(app, app.status);
      const after = toAppDto(app);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.sendWindowChanged,
          payload: audited(ctx, {
            before: { sendWindow: before.sendWindow, mandatoryBypassWindow: before.mandatoryBypassWindow },
            after: { sendWindow: after.sendWindow, mandatoryBypassWindow: after.mandatoryBypassWindow },
          }),
        },
      ]);
      return after;
    });
  }
}
