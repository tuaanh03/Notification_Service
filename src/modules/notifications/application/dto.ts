import type { ExclusionReason, NotificationStatus, RecipientStatus } from '../../../shared/kernel/index.ts';
import type { Notification } from '../domain/entities/notification.ts';
import type { NotificationRecipient } from '../domain/entities/notification-recipient.ts';
import type { Publication } from '../domain/entities/publication.ts';
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
  /** scheduled | queued | sending | sent | no_recipient | failed */
  status: string;
  topic: string;
  /** Gửi bằng template: id + số version đã dùng (ADR-0020). null = nội dung viết thẳng. */
  template: { id: string; version: number } | null;
  idempotencyKey: string | null;
  /** Thư con của lần phát nào (ADR-0028); null = gửi lẻ. */
  publicationId: string | null;
  recipient: NotificationRecipientDto | null;
  createdAt: string;
  /** `scheduled`: lúc thư được gửi theo giới hạn gửi của app (khung giờ / dàn đều — ADR-0032); tới đó mới vào hàng gửi. */
  scheduledAt: string | null;
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
    publicationId: n.publicationId,
    recipient: r
      ? { address: r.address, status: r.status, exclusionReason: r.exclusionReason, error: r.error, sentAt: iso(r.sentAt) }
      : null,
    createdAt: n.createdAt.toISOString(),
    scheduledAt: iso(n.scheduledAt),
    queuedAt: iso(n.queuedAt),
    sendingAt: iso(n.sendingAt),
    finishedAt: iso(n.finishedAt),
  };
}

/**
 * Một lần phát tin vào topic, nhìn từ app service (`POST` / `GET /v1/publications`, ADR-0028).
 * Không có nội dung thư và không có địa chỉ email — cùng lý do với `NotificationDto`; app tra từng thư
 * con bằng `GET /v1/notifications/:id` nếu cần chi tiết.
 */
export interface PublicationDto {
  id: string;
  topic: string;
  template: { id: string; version: number } | null;
  idempotencyKey: string;
  /** in_progress = còn thư con chờ gửi · completed = mọi thư con đã có kết quả. */
  status: 'in_progress' | 'completed';
  recipientCount: number;
  /** pending = scheduled + queued + sending · skipped = no_recipient (bị chặn lúc gửi, ví dụ người nhận vừa tắt topic). */
  counts: { pending: number; sent: number; failed: number; skipped: number };
  recipients: { externalId: string | null; notificationId: string; status: string }[];
  /**
   * Thư con còn chờ giới hạn gửi của app (ADR-0032): thư SỚM nhất / MUỘN nhất sẽ đi lúc nào. Ngoài khung giờ
   * thì hai mốc bằng nhau; dàn đều thì thư con đi rải trong khoảng này. null = không còn thư nào chờ.
   */
  scheduledAt: string | null;
  lastScheduledAt: string | null;
  createdAt: string;
}

export function toPublicationDto(
  p: Publication,
  extra: {
    topicKey: string;
    template: TemplateLabel | null;
    children: readonly Notification[];
    externalIds: ReadonlyMap<string, string>;
  },
): PublicationDto {
  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const child of extra.children) counts[publicationBucket(child.status)] += 1;
  return {
    id: p.id,
    topic: extra.topicKey,
    template: extra.template ? { id: extra.template.templateId, version: extra.template.version } : null,
    idempotencyKey: p.idempotencyKey,
    status: counts.pending > 0 ? 'in_progress' : 'completed',
    recipientCount: p.recipientCount,
    counts,
    recipients: extra.children.map((child) => ({
      externalId: child.targetUserId === null ? null : (extra.externalIds.get(child.targetUserId) ?? null),
      notificationId: child.id,
      status: child.status,
    })),
    ...scheduledRange(extra.children),
    createdAt: p.createdAt.toISOString(),
  };
}

/** Thư con gửi trực tiếp chỉ đi `queued -> sending -> sent | failed` hoặc `queued -> no_recipient`. */
function publicationBucket(status: string): keyof PublicationDto['counts'] {
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  if (status === 'no_recipient') return 'skipped';
  return 'pending';
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
  /** `api` = app gọi `/v1` · `dashboard` = gửi từ màn Soạn thông báo của console. */
  origin: string;
  /** null = user đã không còn trong sổ người nhận. */
  externalId: string | null;
  /** Như `NotificationDto.template`, kèm tên template cho người đọc. */
  template: { id: string; name: string; version: number } | null;
  /** `firstOpenedAt` / `openCount`: đếm "đã mở" ƯỚC LƯỢNG (ADR-0031) — chỉ màn quản trị, không có ở `/v1`. */
  recipient: (Omit<NotificationRecipientDto, 'address'> & { firstOpenedAt: string | null; openCount: number }) | null;
}

/** Một trang lịch sử gửi. `total` để biết còn bao nhiêu trang. */
export interface NotificationPageDto {
  rows: NotificationSummaryDto[];
  total: number;
  limit: number;
  offset: number;
  /** Số thư theo trạng thái — cùng bộ lọc chủ đề / người nhận, bỏ lọc trạng thái (tab đếm trên console). */
  statusCounts: Partial<Record<NotificationStatus, number>>;
}

export function toNotificationSummaryDto(
  n: Notification,
  extra: { topicKey: string; externalId: string | null; recipient: NotificationRecipient | null; template: TemplateLabel | null },
): NotificationSummaryDto {
  const { recipient, template: _template, ...rest } = toNotificationDto(n, extra);
  return {
    ...rest,
    origin: n.origin,
    externalId: extra.externalId,
    template: extra.template ? { id: extra.template.templateId, name: extra.template.name, version: extra.template.version } : null,
    recipient:
      recipient && extra.recipient
        ? {
            status: recipient.status,
            exclusionReason: recipient.exclusionReason,
            error: recipient.error,
            sentAt: recipient.sentAt,
            firstOpenedAt: iso(extra.recipient.firstOpenedAt),
            openCount: extra.recipient.openCount,
          }
        : null,
  };
}

/** Trang "Theo dõi mở thư" (ADR-0031). `ready` = server có khoá ký + domain API công khai — thiếu thì bật cũng không chèn ảnh. */
export interface OpenTrackingDto {
  enabled: boolean;
  ready: boolean;
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
   * Đếm "đã mở" (ADR-0031), trong cửa sổ: `tracked` = thư đã gửi có chèn ảnh theo dõi, `opened` = trong số
   * đó đã mở. Tỉ lệ mở = opened / tracked; `tracked = 0` = app chưa bật đếm (hoặc chưa gửi gì từ lúc bật).
   */
  opens: { tracked: number; opened: number };
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

/** Mốc sớm / muộn nhất của các thư còn `scheduled` — giờ chốt lúc nhận; thả rồi thì không còn tính. */
export function scheduledRange(
  notifications: readonly { status: string; scheduledAt: Date | null }[],
): { scheduledAt: string | null; lastScheduledAt: string | null } {
  const times = notifications
    .filter((n) => n.status === 'scheduled' && n.scheduledAt !== null)
    .map((n) => (n.scheduledAt as Date).getTime());
  if (times.length === 0) return { scheduledAt: null, lastScheduledAt: null };
  return {
    scheduledAt: new Date(Math.min(...times)).toISOString(),
    lastScheduledAt: new Date(Math.max(...times)).toISOString(),
  };
}

/** Số liệu MỘT template (UX-24) — tab "Hiệu quả" của màn soạn. */
export interface TemplateStatsDto {
  window: { from: string; to: string; days: number };
  /** Version đang lọc; null = cộng mọi version. */
  version: number | null;
  /** Mới nhất trước — để chọn lọc và đánh dấu ngày xuất bản trên biểu đồ. */
  versions: { id: string; version: number; publishedAt: string | null }[];
  /** Người nhận theo trạng thái. `failed` gồm cả `bounced`; `pending` = đang gửi. */
  summary: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    pending: number;
    skippedByReason: Partial<Record<ExclusionReason, number>>;
  };
  /** Ước lượng (ADR-0031): `tracked` = thư đã chuyển đi CÓ chèn ảnh; `total` = mọi lượt tải ảnh. */
  opens: { tracked: number; opened: number; total: number };
  /** Số đếm cho các tab người nhận. */
  buckets: { sent: number; opened: number; unopened: number; failed: number; skipped: number };
  /** Đủ `days` ngày (giờ Việt Nam), ngày không có thư = 0. `opened` theo ngày mở lần đầu. */
  series: { date: string; sent: number; failed: number; skipped: number; opened: number }[];
}

export interface TemplateRecipientDto {
  notificationId: string;
  address: string;
  externalId: string | null;
  topicKey: string | null;
  version: number | null;
  status: RecipientStatus;
  exclusionReason: ExclusionReason | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  openTracked: boolean;
  firstOpenedAt: string | null;
  openCount: number;
}

export interface TemplateRecipientPageDto {
  rows: TemplateRecipientDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Màn danh sách template: template chưa gửi trong khoảng thì vắng mặt. */
export interface TemplateSendStatsListDto {
  days: number;
  rows: { templateId: string; sent: number; tracked: number; opened: number }[];
}
