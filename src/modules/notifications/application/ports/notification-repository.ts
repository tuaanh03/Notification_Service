import type { AppId, NotificationId, NotificationStatus, PublicationId, TopicId, UserId } from '../../../../shared/kernel/index.ts';
import type { Notification } from '../../domain/entities/notification.ts';
import type { NotificationRecipient } from '../../domain/entities/notification-recipient.ts';
import type { Publication } from '../../domain/entities/publication.ts';

/** Bộ lọc của màn lịch sử gửi. Trường vắng mặt = không lọc theo trường đó. */
export interface NotificationFilter {
  status?: NotificationStatus | undefined;
  topicId?: TopicId | undefined;
  targetUserId?: UserId | undefined;
}

/** Một trang lịch sử gửi + tổng số, để màn danh sách biết còn bao nhiêu trang. */
export interface NotificationPage {
  rows: Notification[];
  total: number;
}

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
  /**
   * Lịch sử gửi của MỘT app, mới nhất trước (index `idx_notifications_app_created`). Phạm vi luôn
   * là app — không có đường nào liệt kê xuyên app.
   */
  listByApp(appId: AppId, filter: NotificationFilter, page: { limit: number; offset: number }): Promise<NotificationPage>;
  /** Notification ở `sending` từ trước `before` — ứng viên cho job fail-stuck-sending. */
  listStuckSending(before: Date, limit: number): Promise<Notification[]>;
  /** Mọi thư con của MỘT lần phát (ADR-0028) — tối đa `MAX_PUBLICATION_RECIPIENTS` dòng. */
  listByPublication(publicationId: PublicationId): Promise<Notification[]>;
}

/** Lần phát tin vào topic (ADR-0028). Thư con ghi qua `NotificationRepository`. */
export interface PublicationRepository {
  /** Trùng `(app_id, idempotency_key)` -> `PublicationKeyTakenError` (caller trả lần phát cũ). */
  insert(publication: Publication): Promise<void>;
  findById(id: PublicationId): Promise<Publication | null>;
  findByIdempotencyKey(appId: AppId, key: string): Promise<Publication | null>;
}

export interface RecipientRepository {
  /** Người nhận của gửi trực tiếp — một notification, một dòng. */
  findByNotification(notificationId: NotificationId): Promise<NotificationRecipient | null>;
  /** Theo LÔ cho màn danh sách — một truy vấn cho cả trang. Chưa có người nhận thì vắng mặt trong Map. */
  findByNotifications(notificationIds: readonly NotificationId[]): Promise<Map<NotificationId, NotificationRecipient>>;
  insert(recipient: NotificationRecipient): Promise<void>;
  update(recipient: NotificationRecipient): Promise<void>;
  /**
   * Một lượt tải ảnh theo dõi (ADR-0031): `open_count + 1`, `first_opened_at` giữ lần đầu — MỘT UPDATE,
   * không đọc trước nên hai lượt cùng lúc không mất lượt nào. Chỉ thư đã `sent`. false = không dòng nào khớp.
   */
  recordOpen(notificationId: NotificationId, at: Date): Promise<boolean>;
}
