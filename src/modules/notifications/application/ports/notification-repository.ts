import type { AppId, NotificationId } from '../../../../shared/kernel/index.ts';
import type { Notification } from '../../domain/entities/notification.ts';
import type { NotificationRecipient } from '../../domain/entities/notification-recipient.ts';

export interface NotificationRepository {
  /** Trùng `(app_id, idempotency_key)` -> `IdempotencyKeyTakenError` (caller trả bản cũ). */
  insert(notification: Notification): Promise<void>;
  findById(id: NotificationId): Promise<Notification | null>;
  findByIdempotencyKey(appId: AppId, key: string): Promise<Notification | null>;
  /**
   * Ghi chuyển trạng thái đang chờ (`notification.pendingTransition`) CÓ ĐIỀU KIỆN:
   * `UPDATE ... WHERE status = :expectedStatus` + dòng `notification_transitions`, cùng transaction.
   * Bên kia đổi trước -> `ConcurrentTransitionError` — đây là chốt để hai worker không cùng gửi.
   */
  saveTransition(notification: Notification): Promise<void>;
  /** Notification ở `sending` từ trước `before` — ứng viên cho job fail-stuck-sending. */
  listStuckSending(before: Date, limit: number): Promise<Notification[]>;
}

export interface RecipientRepository {
  /** Người nhận của gửi trực tiếp — một notification, một dòng. */
  findByNotification(notificationId: NotificationId): Promise<NotificationRecipient | null>;
  insert(recipient: NotificationRecipient): Promise<void>;
  update(recipient: NotificationRecipient): Promise<void>;
}
