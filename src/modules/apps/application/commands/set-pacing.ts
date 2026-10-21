import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AppId, Clock } from '../../../../shared/kernel/index.ts';
import { toAppDto, type AppDto } from '../dto.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AppRepository } from '../ports/index.ts';
import { requireApp } from './shared.ts';

export interface SetPacingInput {
  appId: AppId;
  /** Tối đa N thư / phút; null = không dàn đều. */
  perMinute: number | null;
  mandatoryBypass: boolean;
}

/**
 * Dàn đều của một app (ADR-0032 GĐ 2) — người quản lý app (`app.manage`), trong trần Super Admin đã đặt
 * (`PACING_ABOVE_CEILING`). Áp cho thư nhận SAU lúc đổi. Không đổi gì -> không ghi, không audit.
 */
export class SetPacing {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: SetPacing['deps']) {
    this.deps = deps;
  }

  async execute(input: SetPacingInput, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = toAppDto(app);
      if (!app.setPacing(input.perMinute, input.mandatoryBypass, clock.now())) return before;
      await apps.update(app, app.status);
      const after = toAppDto(app);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.pacingChanged,
          payload: audited(ctx, {
            before: { sendPerMinute: before.sendPerMinute, mandatoryBypassPacing: before.mandatoryBypassPacing },
            after: { sendPerMinute: after.sendPerMinute, mandatoryBypassPacing: after.mandatoryBypassPacing },
          }),
        },
      ]);
      return after;
    });
  }
}

/**
 * Trần tốc độ của một app (ADR-0032 GĐ 2) — chỉ Super Admin (`platform.manage`). Áp cho MỌI thư của app,
 * kể cả tin bắt buộc: Admin App tự đánh dấu chủ đề là bắt buộc cũng không né được.
 */
export class SetPacingCeiling {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: SetPacingCeiling['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; maxPerMinute: number | null }, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = app.maxSendPerMinute;
      if (!app.setPacingCeiling(input.maxPerMinute, clock.now())) return toAppDto(app);
      await apps.update(app, app.status);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.pacingCeilingChanged,
          payload: audited(ctx, {
            before: { maxSendPerMinute: before },
            after: { maxSendPerMinute: app.maxSendPerMinute },
          }),
        },
      ]);
      return toAppDto(app);
    });
  }
}

/**
 * Trần thư mỗi giờ của một app (ADR-0032 GĐ 3) — chỉ Super Admin (`platform.manage`). Vượt -> app nhận 429
 * `APP_HOURLY_LIMIT` lúc gửi. `mandatoryBypass` = tin bắt buộc được vượt trần.
 */
export class SetHourlyCeiling {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: SetHourlyCeiling['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; maxPerHour: number | null; mandatoryBypass: boolean }, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = { maxSendPerHour: app.maxSendPerHour, mandatoryBypassHourly: app.mandatoryBypassHourly };
      if (!app.setHourlyCeiling(input.maxPerHour, input.mandatoryBypass, clock.now())) return toAppDto(app);
      await apps.update(app, app.status);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.hourlyCeilingChanged,
          payload: audited(ctx, { before, after: { maxSendPerHour: app.maxSendPerHour, mandatoryBypassHourly: app.mandatoryBypassHourly } }),
        },
      ]);
      return toAppDto(app);
    });
  }
}

/**
 * Giới hạn mỗi người nhận mỗi ngày của một app (ADR-0032 GĐ 3) — người quản lý app (`app.manage`). Thư vượt mức bị bỏ
 * qua lúc gửi (`no_recipient`, lý do `recipient_limit`), không dời sang hôm sau.
 */
export class SetRecipientLimit {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; apps: AppRepository };

  constructor(deps: SetRecipientLimit['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; perDay: number | null; mandatoryBypass: boolean }, ctx: CommandContext): Promise<AppDto> {
    const { uow, outbox, clock, apps } = this.deps;
    return uow.run(async () => {
      const app = await requireApp(apps, input.appId);
      const before = { recipientDailyLimit: app.recipientDailyLimit, mandatoryBypassRecipientLimit: app.mandatoryBypassRecipientLimit };
      if (!app.setRecipientLimit(input.perDay, input.mandatoryBypass, clock.now())) return toAppDto(app);
      await apps.update(app, app.status);
      await outbox.append([
        {
          aggregateType: APP_AGGREGATE,
          aggregateId: app.id,
          eventType: APP_EVENTS.recipientLimitChanged,
          payload: audited(ctx, {
            before,
            after: { recipientDailyLimit: app.recipientDailyLimit, mandatoryBypassRecipientLimit: app.mandatoryBypassRecipientLimit },
          }),
        },
      ]);
      return toAppDto(app);
    });
  }
}
