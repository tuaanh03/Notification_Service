import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AppId, Clock } from '../../../../shared/kernel/index.ts';
import { toAppDto, type AppDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository } from '../ports/index.ts';
import { requireApp } from './shared.ts';

/**
 * Bật / tắt đếm "đã mở" của một app (ADR-0031) — người quản lý app (`app.manage`). Chỉ áp cho thư
 * gửi SAU lúc đổi: worker đọc cờ ngay trước khi gửi, thư đã đi rồi thì không thêm / gỡ ảnh được nữa.
 * Giá trị không đổi -> không ghi, không audit.
 */
export class SetOpenTracking {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: SetOpenTracking['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; enabled: boolean }, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = app.trackOpens;
      if (!app.setOpenTracking(input.enabled, clock.now())) return toAppDto(app);
      await apps.update(app, app.status);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.openTrackingChanged,
          payload: audited(ctx, { before: { trackOpens: before }, after: { trackOpens: app.trackOpens } }),
        },
      ]);
      return toAppDto(app);
    });
  }
}
