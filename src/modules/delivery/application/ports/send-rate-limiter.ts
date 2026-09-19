/**
 * Chờ tới khi được phép gửi thêm một email (giới hạn của mailbox gửi, dùng chung mọi worker).
 * Gọi TRƯỚC khi notification được "nhận việc" — xem DeliverEmailNotification.
 */
export interface SendRateLimiter {
  acquire(): Promise<void>;
}
