import type { AuditEntry } from '../../domain/entities/audit-entry.ts';

/** Bộ lọc nhật ký chung của Super Admin. Trường bỏ trống = không lọc. */
export interface AuditSearch {
  actions?: readonly string[] | undefined;
  actor?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  /** Khoảng thời gian `[from, to)`. */
  from?: Date | undefined;
  to?: Date | undefined;
  /** Con trỏ: dòng CUỐI của trang trước — lấy các dòng cũ hơn nó (`at` giảm dần, rồi `audit_id` giảm dần). */
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

export interface AuditLogRepository {
  /** Append-only: không có update, không có delete (SM-8). */
  append(entry: AuditEntry): Promise<void>;
  listByTarget(targetType: string, targetId: string, limit: number): Promise<AuditEntry[]>;
  /** Mới nhất trước. `total` đếm theo bộ lọc, KHÔNG tính con trỏ / limit. */
  search(filter: AuditSearch): Promise<{ items: AuditEntry[]; total: number }>;
}
