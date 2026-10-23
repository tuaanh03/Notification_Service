import type {
  AppId,
  ExclusionReason,
  NotificationId,
  RecipientStatus,
  TemplateVersionId,
  TopicId,
  UserId,
} from '../../../../shared/kernel/index.ts';
import type { TimeRange } from './notification-stats.ts';

/** Tab của danh sách người nhận (UX-24). `failed` gồm cả `bounced` — EWS chưa đọc thư trả về, cột luôn rỗng. */
export const RECIPIENT_BUCKETS = ['sent', 'opened', 'unopened', 'failed', 'skipped'] as const;
export type RecipientBucket = (typeof RECIPIENT_BUCKETS)[number];

/** Một nhóm (trạng thái, lý do bỏ qua) của người nhận. */
export interface RecipientStatusCount {
  status: RecipientStatus;
  reason: ExclusionReason | null;
  count: number;
  /** Thư đã gửi CÓ chèn ảnh theo dõi (ADR-0031) — mẫu số của tỉ lệ mở. */
  tracked: number;
  /** Trong số đó, thư đã mở ít nhất một lần. */
  opened: number;
  /** Tổng lượt tải ảnh, kể cả mở lại. */
  opens: number;
}

/** Số người nhận của một NGÀY giờ Việt Nam (số ngày kể từ epoch theo UTC+7). */
export interface DailyStatusCount {
  day: number;
  status: RecipientStatus;
  count: number;
}

export interface DailyCount {
  day: number;
  count: number;
}

export interface TemplateRecipientRow {
  notificationId: NotificationId;
  topicId: TopicId;
  templateVersionId: TemplateVersionId;
  address: string;
  userId: UserId;
  status: RecipientStatus;
  exclusionReason: ExclusionReason | null;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
  openTracked: boolean;
  firstOpenedAt: Date | null;
  openCount: number;
}

export interface VersionSendCount {
  templateVersionId: TemplateVersionId;
  sent: number;
  tracked: number;
  opened: number;
}

/**
 * Số liệu theo template (UX-24): người nhận của các lần gửi dùng một nhóm version, tạo trong khoảng
 * `[from, to)` theo `notifications.created_at`. Mọi hàm là MỘT truy vấn `GROUP BY` / một trang, phạm vi MỘT app.
 */
export interface TemplateStats {
  countByStatus(appId: AppId, versionIds: readonly TemplateVersionId[], range: TimeRange): Promise<RecipientStatusCount[]>;
  /** Người nhận theo ngày TẠO lần gửi. Chỉ trả những (ngày, trạng thái) có dòng. */
  countByDay(appId: AppId, versionIds: readonly TemplateVersionId[], range: TimeRange): Promise<DailyStatusCount[]>;
  /** Người mở theo ngày MỞ LẦN ĐẦU (của các lần gửi tạo trong khoảng). */
  opensByDay(appId: AppId, versionIds: readonly TemplateVersionId[], range: TimeRange): Promise<DailyCount[]>;
  listRecipients(
    appId: AppId,
    versionIds: readonly TemplateVersionId[],
    range: TimeRange,
    filter: { bucket: RecipientBucket; search?: string | undefined },
    page: { limit: number; offset: number },
  ): Promise<{ rows: TemplateRecipientRow[]; total: number }>;
  /** Màn danh sách template: số đã chuyển đi / có theo dõi / đã mở theo từng version của app. */
  countByVersion(appId: AppId, range: TimeRange): Promise<VersionSendCount[]>;
}
