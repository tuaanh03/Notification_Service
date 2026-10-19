import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { ValidationError, type Clock } from '../../../../shared/kernel/index.ts';
import { isSystemSettingKey, normalizeSetting, SYSTEM_SETTINGS } from '../../domain/rules/system-settings.ts';
import type { SystemSettingDto } from '../dto.ts';
import { SYSTEM_SETTINGS_AGGREGATE, SYSTEM_SETTINGS_EVENTS, SYSTEM_SETTINGS_ID } from '../events.ts';
import type { SystemSettingRepository } from '../ports/index.ts';
import type { SystemSettingsQueries } from '../queries/system-settings-queries.ts';

/**
 * `PUT /admin/system-settings` — chỉ Super Admin. Nhận MỘT PHẦN các khoá; `null` cho khoá có mặc định
 * khác null = về mặc định. Kiểm HẾT rồi mới ghi (một khoá sai là không ghi khoá nào).
 * Audit một dòng `SystemSettingsUpdated` với `before` / `after` của các khoá đã đổi.
 */
export class UpdateSystemSettings {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    settings: SystemSettingRepository;
    queries: SystemSettingsQueries;
  };

  constructor(deps: UpdateSystemSettings['deps']) {
    this.deps = deps;
  }

  async execute(input: { values: Readonly<Record<string, unknown>> }, ctx: CommandContext): Promise<SystemSettingDto[]> {
    const { uow, outbox, clock, settings, queries } = this.deps;
    const entries = Object.entries(input.values);
    if (entries.length === 0) throw ValidationError.of('SETTINGS_EMPTY', 'send at least one setting', 'values');
    const changes = entries.map(([key, raw]) => {
      if (!isSystemSettingKey(key)) throw ValidationError.of('SETTING_UNKNOWN', `unknown setting ${key}`, key);
      // null = về mặc định cho cài đặt số / bật-tắt; với URL, null chính là "chưa khai" (cũng là mặc định).
      const reset = raw === null && (SYSTEM_SETTINGS[key].kind !== 'url' || SYSTEM_SETTINGS[key].default === null);
      return { key, reset, value: reset ? null : normalizeSetting(key, raw) };
    });

    const before = Object.fromEntries((await queries.list()).map((s) => [s.key, s.value]));
    await uow.run(async () => {
      const now = clock.now();
      for (const change of changes) {
        if (change.reset) await settings.delete(change.key);
        else await settings.upsert({ key: change.key, value: change.value, updatedBy: ctx.actor.id, updatedAt: now });
      }
      await outbox.append([
        {
          aggregateType: SYSTEM_SETTINGS_AGGREGATE,
          aggregateId: SYSTEM_SETTINGS_ID,
          eventType: SYSTEM_SETTINGS_EVENTS.updated,
          payload: audited(ctx, {
            before: Object.fromEntries(changes.map((c) => [c.key, before[c.key] ?? null])),
            after: Object.fromEntries(
              changes.map((c) => [c.key, c.reset ? SYSTEM_SETTINGS[c.key].default : c.value]),
            ),
          }),
        },
      ]);
    });
    queries.invalidate();
    return queries.list();
  }
}
