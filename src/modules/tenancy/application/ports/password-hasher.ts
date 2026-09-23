/**
 * Băm và kiểm mật khẩu. Là PORT vì tầng application không được import package nào — kể cả
 * `node:crypto` (luật kiến trúc ép điều đó). Nhờ vậy đổi thuật toán không phải sửa use case.
 *
 * Khác hẳn API key: key là 256 bit ngẫu nhiên nên SHA-256 là đủ (ADR-0015 §3). Mật khẩu người
 * đặt thì entropy thấp -> bắt buộc hàm băm CHẬM, có salt.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  /** Sai mật khẩu và băm hỏng định dạng đều trả `false` — không ném lỗi, không lộ lý do. */
  verify(plaintext: string, hash: string): Promise<boolean>;
}
