import { ValidationError } from './errors.ts';
import type { Brand } from './ids.ts';

/**
 * Email đã chuẩn hoá — khoá merge của Identity Resolver (persons.primary_email).
 *
 * QUY TẮC ĐÃ CHỐT: chỉ trim + lowercase. KHÔNG strip `+tag`, KHÔNG bỏ dấu chấm kiểu Gmail.
 * Lý do: strip sai sẽ gộp nhầm hai người cố ý tách hộp thư bằng `+shop` / `+seller`,
 * và gộp nhầm person nghĩa là thư riêng của người này lọt sang người kia.
 *
 * Đổi hàm này = phải chạy lại toàn bộ person đã gộp. Sửa ở đây, không sửa ở nơi gọi.
 */
export type NormalizedEmail = Brand<string, 'NormalizedEmail'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): NormalizedEmail {
  const value = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) {
    throw new ValidationError([`email không hợp lệ: ${raw}`]);
  }
  return value as NormalizedEmail;
}

export function isEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim().toLowerCase());
}

/**
 * Số điện thoại đã chuẩn hoá — khoá merge phụ, chỉ dùng khi đã xác thực OTP.
 * Chuẩn hoá về dạng chỉ chữ số, giữ dấu `+` đầu nếu có.
 */
export type NormalizedPhone = Brand<string, 'NormalizedPhone'>;

export function normalizePhone(raw: string): NormalizedPhone {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw new ValidationError([`số điện thoại không hợp lệ: ${raw}`]);
  }
  return `${plus}${digits}` as NormalizedPhone;
}
