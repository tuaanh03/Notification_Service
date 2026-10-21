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
  /** Số incoming hook tối đa mỗi app (mỗi công cụ ngoài một hook). */
  'incoming.max_hooks_per_app': { kind: 'int', default: 20, min: 1, max: 50 },
  /** Domain API công khai — console ghép URL đầy đủ của hook. null = chưa khai. */
  'api.public_base_url': { kind: 'url', default: null },
  /** Số khoá API đang hoạt động tối đa mỗi app — mỗi nơi gọi một khoá, có trần để khoá bỏ quên không tích tụ. */
  'apps.max_active_api_keys': { kind: 'int', default: 20, min: 1, max: 100 },
  /** Số URL nhận outgoing webhook tối đa mỗi app — mỗi URL là thêm một lần gọi cho mỗi thư. */
  'webhooks.max_endpoints_per_app': { kind: 'int', default: 10, min: 1, max: 50 },
  /**
   * Bộ kiểm HTML an toàn (`checkEmailHtml`, ADR-0036) chạy cả khi XUẤT BẢN template kiểu `html` (ADR-0038). Công tắc
   * an toàn: tắt = xuất bản kiểu `html` như trước (chỉ luật nội dung). Kiểu `visual` luôn kiểm lúc lưu, không theo cờ này.
   */
  'templates.html_check_enabled': { kind: 'bool', default: true },
  /**
   * Chặn đăng nhập mật khẩu sai nhiều lần (ADR-0039) — console hiện ở mục riêng "Theo dõi & Bảo mật", không ở trang
   * Cài đặt hệ thống. Tắt = không đếm, không khoá (khoá hẳn đã ghi trên tài khoản vẫn giữ).
   */
  'auth.lockout_enabled': { kind: 'bool', default: true },
  /** Sai chừng này lần liên tiếp cho MỘT email trong `auth.failure_window_minutes` -> khoá tạm email đó. */
  'auth.max_failed_attempts': { kind: 'int', default: 5, min: 3, max: 20 },
  /** Khung đếm lần sai, tính từ lần sai đầu tiên. */
  'auth.failure_window_minutes': { kind: 'int', default: 15, min: 1, max: 1440 },
  /** Khoá tạm kéo dài chừng này phút rồi tự mở. */
  'auth.lockout_minutes': { kind: 'int', default: 15, min: 1, max: 1440 },
  /** Một IP sai chừng này lần (mọi email cộng lại) trong cùng khung -> khoá tạm IP đó: chặn thử một mật khẩu với nhiều email. */
  'auth.ip_max_failed_attempts': { kind: 'int', default: 30, min: 10, max: 1000 },
  /**
   * Bị khoá tạm chừng này lần liên tiếp (trong 24 giờ, chưa đăng nhập đúng lần nào) -> KHOÁ HẲN tài khoản, chỉ Super Admin
   * mở. 0 = không bao giờ khoá hẳn — mặc định, vì ai biết email cũng cố tình nhập sai để khoá được người khác.
   */
  'auth.permanent_lock_after': { kind: 'int', default: 0, min: 0, max: 10 },
} as const satisfies Record<string, SettingSpec>;

type SettingSpec =
  | { kind: 'int'; default: number; min: number; max: number }
  | { kind: 'url'; default: string | null }
  | { kind: 'bool'; default: boolean };

export type SystemSettingKey = keyof typeof SYSTEM_SETTINGS;
export const SYSTEM_SETTING_KEYS = Object.keys(SYSTEM_SETTINGS) as SystemSettingKey[];

/** Giá trị hiệu lực của mọi cài đặt (đã gộp mặc định). */
export interface SystemSettingsValues {
  'incoming.dedupe_window_minutes': number;
  'incoming.max_publications_per_minute': number;
  'incoming.max_hooks_per_app': number;
  'api.public_base_url': string | null;
  'apps.max_active_api_keys': number;
  'webhooks.max_endpoints_per_app': number;
  'templates.html_check_enabled': boolean;
  'auth.lockout_enabled': boolean;
  'auth.max_failed_attempts': number;
  'auth.failure_window_minutes': number;
  'auth.lockout_minutes': number;
  'auth.ip_max_failed_attempts': number;
  'auth.permanent_lock_after': number;
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
    'incoming.max_hooks_per_app': pick('incoming.max_hooks_per_app'),
    'api.public_base_url': pick('api.public_base_url'),
    'apps.max_active_api_keys': pick('apps.max_active_api_keys'),
    'webhooks.max_endpoints_per_app': pick('webhooks.max_endpoints_per_app'),
    'templates.html_check_enabled': pick('templates.html_check_enabled'),
    'auth.lockout_enabled': pick('auth.lockout_enabled'),
    'auth.max_failed_attempts': pick('auth.max_failed_attempts'),
    'auth.failure_window_minutes': pick('auth.failure_window_minutes'),
    'auth.lockout_minutes': pick('auth.lockout_minutes'),
    'auth.ip_max_failed_attempts': pick('auth.ip_max_failed_attempts'),
    'auth.permanent_lock_after': pick('auth.permanent_lock_after'),
  };
}

/**
 * Kiểm + chuẩn hoá MỘT giá trị. Sai -> ValidationError có mã ổn định:
 *   SETTING_OUT_OF_RANGE (số ngoài khoảng / không nguyên) · SETTING_INVALID_URL · SETTING_INVALID_BOOLEAN.
 */
export function normalizeSetting(key: SystemSettingKey, value: unknown): number | string | boolean | null {
  const spec: SettingSpec = SYSTEM_SETTINGS[key];
  if (spec.kind === 'bool') {
    if (typeof value !== 'boolean') throw ValidationError.of('SETTING_INVALID_BOOLEAN', `${key} must be true or false`, key);
    return value;
  }
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
