import type { LoginThrottlePolicy } from '../../domain/rules/login-throttle.ts';

/** Kết quả ghi MỘT lần sai. */
export interface LoginFailureOutcome {
  /** Lần sai này vừa khoá tạm email -> hạn mở khoá; không thì `null`. */
  emailLockedUntil: Date | null;
  /** Số lần khoá tạm liên tiếp của email, tính cả lần vừa khoá (0 khi chưa khoá lần nào). */
  streak: number;
  /** Lần sai này vừa khoá tạm IP -> hạn mở khoá; không thì `null`. */
  ipLockedUntil: Date | null;
}

/** Một khoá tạm đang hiệu lực — theo email hoặc theo IP. */
export interface LoginLockEntry {
  kind: 'email' | 'ip';
  /** Email đã hạ chữ thường, hoặc địa chỉ IP. */
  subject: string;
  lockedAt: Date;
  until: Date;
}

/**
 * Bộ đếm lần đăng nhập sai và khoá tạm (ADR-0039). Giữ ở chỗ MỌI bản `api` cùng thấy (Redis), tự hết hạn.
 * `ip = null` = không biết IP thật của người dùng (console chưa chuyển, hoặc khoá chung sai) -> chỉ đếm theo email.
 */
export interface LoginAttemptStore {
  /** Email hoặc IP đang bị khoá tạm -> hạn mở khoá muộn nhất; không thì `null`. */
  lockedUntil(subject: string, ip: string | null, now: Date): Promise<Date | null>;
  recordFailure(subject: string, ip: string | null, policy: LoginThrottlePolicy, now: Date): Promise<LoginFailureOutcome>;
  /** Đăng nhập đúng: xoá bộ đếm và chuỗi khoá liên tiếp của email (không đụng bộ đếm IP). */
  clear(subject: string): Promise<void>;
  list(now: Date): Promise<LoginLockEntry[]>;
  /** Gỡ khoá tạm + bộ đếm. Trả `false` khi không có khoá nào đang giữ. */
  unlock(kind: 'email' | 'ip', subject: string): Promise<boolean>;
}

/** Chính sách đang hiệu lực — đọc từ cài đặt hệ thống `auth.*` (module settings), đệm ngắn. */
export interface LoginThrottlePolicySource {
  current(): Promise<LoginThrottlePolicy>;
}
