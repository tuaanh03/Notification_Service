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
