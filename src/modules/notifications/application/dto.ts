import type { Notification } from '../domain/entities/notification.ts';
import type { NotificationRecipient } from '../domain/entities/notification-recipient.ts';
import type { TemplateLabel } from './ports/index.ts';

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
  /** Gửi bằng template: id + số version đã dùng (ADR-0020). null = nội dung viết thẳng. */
  template: { id: string; version: number } | null;
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
  extra: { topicKey: string; recipient: NotificationRecipient | null; template: TemplateLabel | null },
): NotificationDto {
  const r = extra.recipient;
  return {
    id: n.id,
    status: n.status,
    topic: extra.topicKey,
    template: extra.template ? { id: extra.template.templateId, version: extra.template.version } : null,
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
export interface NotificationSummaryDto extends Omit<NotificationDto, 'recipient' | 'template'> {
  /** null = user đã không còn trong sổ người nhận. */
  externalId: string | null;
  /** Như `NotificationDto.template`, kèm tên template cho người đọc. */
  template: { id: string; name: string; version: number } | null;
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
  extra: { topicKey: string; externalId: string | null; recipient: NotificationRecipient | null; template: TemplateLabel | null },
): NotificationSummaryDto {
  const { recipient, template: _template, ...rest } = toNotificationDto(n, extra);
  return {
    ...rest,
    externalId: extra.externalId,
    template: extra.template ? { id: extra.template.templateId, name: extra.template.name, version: extra.template.version } : null,
    recipient: recipient
      ? { status: recipient.status, exclusionReason: recipient.exclusionReason, error: recipient.error, sentAt: recipient.sentAt }
      : null,
  };
}

/**
 * Số liệu màn Tổng quan của MỘT app (`GET /admin/apps/:appId/overview`). Mọi mốc giờ là UTC —
 * console tự đổi sang giờ địa phương khi hiển thị.
 */
export interface AppOverviewDto {
  generatedAt: string;
  /** 24 giờ gần nhất, trượt theo lúc gọi: `[from, to)`. */
  window: { from: string; to: string };
  /** Số lần gửi tạo trong cửa sổ, và trong 24 giờ liền trước nó (để tính chênh lệch). */
  sends: { total: number; previousTotal: number };
  /** Các lần gửi trong cửa sổ, theo trạng thái hiện tại. Đủ mọi trạng thái, không có thì 0. */
  byStatus: Record<string, number>;
  /** Vì sao thư bị chặn (`exclusion_reason`), trong cửa sổ. Đủ mọi lý do, không có thì 0. */
  blocked: Record<string, number>;
  /**
   * 24 cột theo giờ tạo, cũ trước, đủ 24 dòng kể cả giờ trống. Cột cuối là giờ hiện tại (chưa trọn),
   * cột đầu bắt đầu ở đầu giờ của 23 giờ trước.
   *   sent = `sent` · failed = `failed` · blocked = `no_recipient` · pending = `queued` + `sending`
   */
  hourly: { hour: string; sent: number; failed: number; blocked: number; pending: number }[];
  /** Hàng chờ ngay lúc này, không giới hạn thời gian tạo. */
  queue: { waiting: number; oldestCreatedAt: string | null };
  /** Người nhận của app và tình trạng email của họ. */
  recipients: { total: number; emailActive: number; emailUnsubscribed: number; emailInvalid: number };
  topics: { total: number; active: number };
}
