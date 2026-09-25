import type { AppId, ExclusionReason, NotificationStatus } from '../../../../shared/kernel/index.ts';

/** Khoảng thời gian nửa mở `[from, to)` theo `created_at`. */
export interface TimeRange {
  from: Date;
  to: Date;
}

/** Số lần gửi của một giờ (UTC) theo trạng thái. */
export interface HourlyStatusCount {
  /** Đầu giờ, UTC. */
  hour: Date;
  status: NotificationStatus;
  count: number;
}

/**
 * Đếm cho màn Tổng quan — mọi hàm là MỘT truy vấn `GROUP BY` trong MySQL, không kéo từng dòng lên.
 * Phạm vi luôn là MỘT app.
 */
export interface NotificationStats {
  /** Số lần gửi tạo trong khoảng, theo trạng thái HIỆN TẠI. Trạng thái không có dòng nào -> 0. */
  countByStatus(appId: AppId, range: TimeRange): Promise<Record<NotificationStatus, number>>;
  /** Như `countByStatus` nhưng chia theo giờ tạo. Chỉ trả những (giờ, trạng thái) có dòng. */
  countByHour(appId: AppId, range: TimeRange): Promise<HourlyStatusCount[]>;
  /** Vì sao thư bị chặn, đếm trên người nhận của các lần gửi tạo trong khoảng. */
  countExclusions(appId: AppId, range: TimeRange): Promise<Record<ExclusionReason, number>>;
  /** Hàng chờ NGAY LÚC NÀY (`queued` + `sending`), không giới hạn thời gian tạo. */
  backlog(appId: AppId): Promise<{ waiting: number; oldestCreatedAt: Date | null }>;
}
