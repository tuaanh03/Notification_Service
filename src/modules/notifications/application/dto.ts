import type { Notification } from '../domain/entities/notification.ts';
import type { NotificationRecipient } from '../domain/entities/notification-recipient.ts';

export interface NotificationRecipientDto {
  address: string;
  /** pending | sent | failed | skipped */
  status: string;
  /** Vì sao KHÔNG gửi: no_channel | invalid | suppressed | opted_out_optional | opted_out */
  exclusionReason: string | null;
  error: string | null;
  sentAt: string | null;
}

/**
 * Trạng thái một lần gửi, nhìn từ app service (`GET /v1/notifications/:id`). Không có nội dung email —
 * app đã có nội dung đó; trả lại là tăng bề mặt rò rỉ mà không ai cần.
 */
export interface NotificationDto {
  id: string;
  /** queued | sending | sent | no_recipient | failed */
  status: string;
  topic: string;
  idempotencyKey: string | null;
  recipient: NotificationRecipientDto | null;
  createdAt: string;
  queuedAt: string | null;
  sendingAt: string | null;
  finishedAt: string | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toNotificationDto(
  n: Notification,
  extra: { topicKey: string; recipient: NotificationRecipient | null },
): NotificationDto {
  const r = extra.recipient;
  return {
    id: n.id,
    status: n.status,
    topic: extra.topicKey,
    idempotencyKey: n.idempotencyKey,
    recipient: r
      ? { address: r.address, status: r.status, exclusionReason: r.exclusionReason, error: r.error, sentAt: iso(r.sentAt) }
      : null,
    createdAt: n.createdAt.toISOString(),
    queuedAt: iso(n.queuedAt),
    sendingAt: iso(n.sendingAt),
    finishedAt: iso(n.finishedAt),
  };
}

/**
 * Một dòng lịch sử gửi cho màn quản trị (`GET /admin/apps/:appId/notifications`).
 *
 * Khác `NotificationDto` hai chỗ, đều có chủ đích:
 *   - có `externalId` — người trực tra theo mã nhân viên, không theo `user_id` nội bộ;
 *   - người nhận KHÔNG kèm địa chỉ email. Địa chỉ đã có ở màn Người nhận; nhân ra thêm một màn
 *     danh sách là thêm một chỗ lộ dữ liệu cá nhân mà không giúp gì cho việc tra.
 * Không có nội dung thư — cùng lý do với `NotificationDto`.
 */
export interface NotificationSummaryDto extends Omit<NotificationDto, 'recipient'> {
  /** null = user đã không còn trong sổ người nhận. */
  externalId: string | null;
  recipient: Omit<NotificationRecipientDto, 'address'> | null;
}

/** Một trang lịch sử gửi. `total` để biết còn bao nhiêu trang. */
export interface NotificationPageDto {
  rows: NotificationSummaryDto[];
  total: number;
  limit: number;
  offset: number;
}

export function toNotificationSummaryDto(
  n: Notification,
  extra: { topicKey: string; externalId: string | null; recipient: NotificationRecipient | null },
): NotificationSummaryDto {
  const { recipient, ...rest } = toNotificationDto(n, extra);
  return {
    ...rest,
    externalId: extra.externalId,
    recipient: recipient
      ? { status: recipient.status, exclusionReason: recipient.exclusionReason, error: recipient.error, sentAt: recipient.sentAt }
      : null,
  };
}
