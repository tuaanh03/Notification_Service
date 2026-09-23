import { ValidationError } from '../../../../shared/kernel/index.ts';

/**
 * Chỉ ép độ dài, KHÔNG ép trộn hoa/thường/ký tự đặc biệt: ép trộn đẩy người dùng về đúng những
 * mẫu đoán được ("Password1!"). Độ dài mới là thứ làm mật khẩu khó dò.
 */
export const MIN_PASSWORD_LENGTH = 12;
/** Chặn trên vì băm CHẬM: chuỗi dài vô hạn biến việc đăng nhập thành cách làm nghẽn CPU. */
export const MAX_PASSWORD_LENGTH = 200;

export function assertPasswordAllowed(plaintext: string): void {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    throw ValidationError.of('PASSWORD_TOO_SHORT', `password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'password');
  }
  if (plaintext.length > MAX_PASSWORD_LENGTH) {
    throw ValidationError.of('PASSWORD_TOO_LONG', `password must be at most ${MAX_PASSWORD_LENGTH} characters`, 'password');
  }
}
