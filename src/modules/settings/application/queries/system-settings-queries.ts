import type { Clock } from '../../../../shared/kernel/index.ts';
import {
  effectiveSettings,
  SYSTEM_SETTING_KEYS,
  SYSTEM_SETTINGS,
  type SystemSettingsValues,
} from '../../domain/rules/system-settings.ts';
import type { SystemSettingDto } from '../dto.ts';
import type { SystemSettingRepository } from '../ports/index.ts';

/** Process khác đọc lại tối đa chừng này sau khi Super Admin đổi cài đặt. */
export const SETTINGS_CACHE_MS = 30_000;

/**
 * Đọc cài đặt hệ thống. `current()` là cửa CÔNG KHAI cho module khác (incoming webhook) — có bộ nhớ
 * đệm 30 giây để route nóng không đọc DB mỗi lần; process vừa ghi thì xoá đệm ngay (`invalidate`).
 */
export class SystemSettingsQueries {
  private readonly deps: { settings: SystemSettingRepository; clock: Clock };
  private cached: { values: SystemSettingsValues; until: number } | null = null;

  constructor(deps: SystemSettingsQueries['deps']) {
    this.deps = deps;
  }

  async current(): Promise<SystemSettingsValues> {
    const now = this.deps.clock.now().getTime();
    if (this.cached && this.cached.until > now) return this.cached.values;
    const stored = await this.deps.settings.listAll();
    const values = effectiveSettings(new Map(stored.map((s) => [s.key, s.value])));
    this.cached = { values, until: now + SETTINGS_CACHE_MS };
    return values;
  }

  invalidate(): void {
    this.cached = null;
  }

  /** Màn Cài đặt hệ thống: mọi khoá trong danh mục, kể cả khoá chưa ai chỉnh. */
  async list(): Promise<SystemSettingDto[]> {
    const stored = await this.deps.settings.listAll();
    const byKey = new Map(stored.map((s) => [s.key, s]));
    const values = effectiveSettings(new Map(stored.map((s) => [s.key, s.value])));
    return SYSTEM_SETTING_KEYS.map((key) => {
      const spec = SYSTEM_SETTINGS[key];
      const row = byKey.get(key);
      return {
        key,
        kind: spec.kind,
        value: values[key],
        default: spec.default,
        min: spec.kind === 'int' ? spec.min : null,
        max: spec.kind === 'int' ? spec.max : null,
        customized: row !== undefined,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }
}
