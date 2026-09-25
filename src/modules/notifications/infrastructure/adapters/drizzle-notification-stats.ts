import { and, count, eq, gte, inArray, isNotNull, lt, min, sql } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import {
  EXCLUSION_REASONS,
  NOTIFICATION_STATUSES,
  type AppId,
  type ExclusionReason,
  type NotificationStatus,
} from '../../../../shared/kernel/index.ts';
import type { HourlyStatusCount, NotificationStats, TimeRange } from '../../application/ports/index.ts';
import { notificationRecipients, notifications } from '../db/schema.ts';

const HOUR_MS = 3_600_000;

/**
 * Số giờ kể từ epoch của `created_at`. Session MySQL chạy UTC (`shared/db/client.ts`), nên
 * `UNIX_TIMESTAMP` đọc DATETIME đúng như giá trị đã ghi. Kết quả là DECIMAL — mysql2 trả chuỗi.
 */
const createdHour = sql<string>`floor(unix_timestamp(${notifications.createdAt}) / 3600)`;

/** Đếm cho màn Tổng quan. Mọi truy vấn đi theo index `idx_notifications_app_created`, trừ `backlog`. */
export class DrizzleNotificationStats implements NotificationStats {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async countByStatus(appId: AppId, range: TimeRange): Promise<Record<NotificationStatus, number>> {
    const rows = await this.transactions
      .executor()
      .select({ status: notifications.status, value: count() })
      .from(notifications)
      .where(inRange(appId, range))
      .groupBy(notifications.status);
    const counts = zeros(NOTIFICATION_STATUSES);
    for (const row of rows) counts[row.status] = row.value;
    return counts;
  }

  async countByHour(appId: AppId, range: TimeRange): Promise<HourlyStatusCount[]> {
    const rows = await this.transactions
      .executor()
      .select({ hour: createdHour, status: notifications.status, value: count() })
      .from(notifications)
      .where(inRange(appId, range))
      .groupBy(createdHour, notifications.status);
    return rows.map((row) => ({ hour: new Date(Number(row.hour) * HOUR_MS), status: row.status, count: row.value }));
  }

  async countExclusions(appId: AppId, range: TimeRange): Promise<Record<ExclusionReason, number>> {
    const rows = await this.transactions
      .executor()
      .select({ reason: notificationRecipients.exclusionReason, value: count() })
      .from(notificationRecipients)
      .innerJoin(notifications, eq(notifications.notificationId, notificationRecipients.notificationId))
      .where(and(inRange(appId, range), isNotNull(notificationRecipients.exclusionReason)))
      .groupBy(notificationRecipients.exclusionReason);
    const counts = zeros(EXCLUSION_REASONS);
    for (const row of rows) if (row.reason !== null) counts[row.reason] = row.value;
    return counts;
  }

  async backlog(appId: AppId): Promise<{ waiting: number; oldestCreatedAt: Date | null }> {
    // Điều kiện `status IN (...)` cho MySQL dùng index `idx_notifications_status_sending` (status đứng
    // đầu) thay vì quét cả lịch sử của app — hàng chờ luôn nhỏ so với lịch sử.
    const [row] = await this.transactions
      .executor()
      .select({ waiting: count(), oldest: min(notifications.createdAt) })
      .from(notifications)
      .where(and(eq(notifications.appId, appId), inArray(notifications.status, ['queued', 'sending'])));
    return { waiting: row?.waiting ?? 0, oldestCreatedAt: row?.oldest ?? null };
  }
}

function inRange(appId: AppId, range: TimeRange) {
  return and(eq(notifications.appId, appId), gte(notifications.createdAt, range.from), lt(notifications.createdAt, range.to));
}

function zeros<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}
