import { ValidationError } from '../../../../shared/kernel/index.ts';

/**
 * Cài đặt hệ thống do Super Admin chỉnh trên console (ADR-0030) — con số vận hành cần đổi mà không
 * phải deploy. Danh mục cố định ở đây: khoá lạ bị từ chối, mỗi khoá có mặc định + khoảng cho phép.
 * Thêm cài đặt = thêm một dòng ở đây (+ câu dịch trên console), không đổi bảng.
 */
export const SYSTEM_SETTINGS = {
  /** Incoming webhook không có khoá chống trùng: cùng body trong khung này chỉ phát một lần. */
  'incoming.dedupe_window_minutes': { kind: 'int', default: 10, min: 1, max: 1440 },
  /** Mỗi hook phát tối đa chừng này lần mỗi phút — chặn "bão" cảnh báo. */
  'incoming.max_publications_per_minute': { kind: 'int', default: 20, min: 1, max: 600 },
  /** Domain API công khai — console ghép URL đầy đủ của hook. null = chưa khai. */
  'api.public_base_url': { kind: 'url', default: null },
  /** Số khoá API đang hoạt động tối đa mỗi app — mỗi nơi gọi một khoá, có trần để khoá bỏ quên không tích tụ. */
  'apps.max_active_api_keys': { kind: 'int', default: 20, min: 1, max: 100 },
} as const satisfies Record<string, SettingSpec>;

type SettingSpec = { kind: 'int'; default: number; min: number; max: number } | { kind: 'url'; default: string | null };

export type SystemSettingKey = keyof typeof SYSTEM_SETTINGS;
export const SYSTEM_SETTING_KEYS = Object.keys(SYSTEM_SETTINGS) as SystemSettingKey[];

/** Giá trị hiệu lực của mọi cài đặt (đã gộp mặc định). */
export interface SystemSettingsValues {
  'incoming.dedupe_window_minutes': number;
  'incoming.max_publications_per_minute': number;
  'api.public_base_url': string | null;
  'apps.max_active_api_keys': number;
}

export const isSystemSettingKey = (key: string): key is SystemSettingKey => Object.hasOwn(SYSTEM_SETTINGS, key);

/** Gộp các giá trị đã lưu vào mặc định. Giá trị lưu mà không còn hợp lệ (khoảng bị thu hẹp) -> mặc định. */
export function effectiveSettings(stored: ReadonlyMap<string, unknown>): SystemSettingsValues {
  const pick = <K extends SystemSettingKey>(key: K): SystemSettingsValues[K] => {
    if (!stored.has(key)) return SYSTEM_SETTINGS[key].default as SystemSettingsValues[K];
    try {
      return normalizeSetting(key, stored.get(key)) as SystemSettingsValues[K];
    } catch {
      return SYSTEM_SETTINGS[key].default as SystemSettingsValues[K];
    }
  };
  return {
    'incoming.dedupe_window_minutes': pick('incoming.dedupe_window_minutes'),
    'incoming.max_publications_per_minute': pick('incoming.max_publications_per_minute'),
    'api.public_base_url': pick('api.public_base_url'),
    'apps.max_active_api_keys': pick('apps.max_active_api_keys'),
  };
}

/**
 * Kiểm + chuẩn hoá MỘT giá trị. Sai -> ValidationError có mã ổn định:
 *   SETTING_OUT_OF_RANGE (số ngoài khoảng / không nguyên) · SETTING_INVALID_URL.
 */
export function normalizeSetting(key: SystemSettingKey, value: unknown): number | string | null {
  const spec: SettingSpec = SYSTEM_SETTINGS[key];
  if (spec.kind === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max) {
      throw ValidationError.of('SETTING_OUT_OF_RANGE', `${key} must be an integer between ${spec.min} and ${spec.max}`, key);
    }
    return value;
  }
  if (value === null) return null;
  if (typeof value !== 'string') throw ValidationError.of('SETTING_INVALID_URL', `${key} must be a URL`, key);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw ValidationError.of('SETTING_INVALID_URL', `${key} is not a valid URL`, key);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.search !== '' || url.hash !== '' || url.username !== '') {
    throw ValidationError.of('SETTING_INVALID_URL', `${key} must be an https:// base URL without query or fragment`, key);
  }
  return url.toString().replace(/\/+$/, '');
}
