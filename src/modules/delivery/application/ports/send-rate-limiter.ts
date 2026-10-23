/** Làn gửi (ADR-0041): `priority` = tin bắt buộc, được dùng cả phần lượt mỗi phút giữ riêng. */
export type SendLane = 'normal' | 'priority';

/**
 * Chờ tới khi được phép gửi thêm một email (giới hạn của mailbox gửi, dùng chung mọi worker).
 * Gọi TRƯỚC khi notification được "nhận việc" — xem DeliverEmailNotification.
 */
export interface SendRateLimiter {
  acquire(lane: SendLane): Promise<void>;
}
