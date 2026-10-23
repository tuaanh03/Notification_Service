import { and, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, sql, type SQL } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import type { AppId, TemplateVersionId, UserId } from '../../../../shared/kernel/index.ts';
import type {
  DailyCount,
  DailyStatusCount,
  RecipientBucket,
  RecipientStatusCount,
  TemplateRecipientRow,
  TemplateStats,
  TimeRange,
  VersionSendCount,
} from '../../application/ports/index.ts';
import { notificationRecipients as nr, notifications as n } from '../db/schema.ts';

/** Giờ Việt Nam lệch UTC +7 (không có giờ mùa hè). Session MySQL chạy UTC (`shared/db/client.ts`). */
const VN_OFFSET_SECONDS = 7 * 3600;
const vnDay = (column: typeof n.createdAt | typeof nr.firstOpenedAt) =>
  sql<string>`floor((unix_timestamp(${column}) + ${VN_OFFSET_SECONDS}) / 86400)`;
const createdDay = vnDay(n.createdAt);
const openedDay = vnDay(nr.firstOpenedAt);

/** `count(CASE ... THEN 1 END)` — COUNT bỏ qua NULL. MySQL trả số, mysql2 có thể trả chuỗi với SUM. */
const countIf = (condition: SQL) => sql<number>`count(case when ${condition} then 1 end)`.mapWith(Number);

/** Số liệu template (UX-24). Mọi truy vấn lọc `app_id` + `template_version_id IN` + `created_at` — chỉ mục `idx_notifications_template_created`. */
export class DrizzleTemplateStats implements TemplateStats {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async countByStatus(appId: AppId, versionIds: readonly TemplateVersionId[], range: TimeRange): Promise<RecipientStatusCount[]> {
    if (versionIds.length === 0) return [];
    const rows = await this.transactions
      .executor()
      .select({
        status: nr.status,
        reason: nr.exclusionReason,
        count: count(),
        tracked: countIf(and(eq(nr.status, 'sent'), eq(nr.openTracked, true))!),
        opened: countIf(and(eq(nr.status, 'sent'), eq(nr.openTracked, true), isNotNull(nr.firstOpenedAt))!),
        opens: sql<number>`coalesce(sum(case when ${nr.status} = 'sent' and ${nr.openTracked} then ${nr.openCount} end), 0)`.mapWith(Number),
      })
      .from(nr)
      .innerJoin(n, eq(n.notificationId, nr.notificationId))
      .where(scope(appId, versionIds, range))
      .groupBy(nr.status, nr.exclusionReason);
    return rows;
  }

  async countByDay(appId: AppId, versionIds: readonly TemplateVersionId[], range: TimeRange): Promise<DailyStatusCount[]> {
    if (versionIds.length === 0) return [];
    const rows = await this.transactions
      .executor()
      .select({ day: createdDay, status: nr.status, count: count() })
      .from(nr)
      .innerJoin(n, eq(n.notificationId, nr.notificationId))
      .where(scope(appId, versionIds, range))
      .groupBy(createdDay, nr.status);
    return rows.map((row) => ({ day: Number(row.day), status: row.status, count: row.count }));
  }

  async opensByDay(appId: AppId, versionIds: readonly TemplateVersionId[], range: TimeRange): Promise<DailyCount[]> {
    if (versionIds.length === 0) return [];
    const rows = await this.transactions
      .executor()
      .select({ day: openedDay, count: count() })
      .from(nr)
      .innerJoin(n, eq(n.notificationId, nr.notificationId))
      .where(and(scope(appId, versionIds, range), eq(nr.status, 'sent'), eq(nr.openTracked, true), isNotNull(nr.firstOpenedAt)))
      .groupBy(openedDay);
    return rows.map((row) => ({ day: Number(row.day), count: row.count }));
  }

  async listRecipients(
    appId: AppId,
    versionIds: readonly TemplateVersionId[],
    range: TimeRange,
    filter: { bucket: RecipientBucket; search?: string | undefined },
    page: { limit: number; offset: number },
  ): Promise<{ rows: TemplateRecipientRow[]; total: number }> {
    if (versionIds.length === 0) return { rows: [], total: 0 };
    const where = and(
      scope(appId, versionIds, range),
      BUCKET[filter.bucket](),
      filter.search ? like(nr.address, `%${escapeLike(filter.search)}%`) : undefined,
    );
    const db = this.transactions.executor();
    const [rows, [total]] = await Promise.all([
      db
        .select({
          notificationId: nr.notificationId,
          topicId: n.topicId,
          templateVersionId: n.templateVersionId,
          address: nr.address,
          userId: nr.userId,
          status: nr.status,
          exclusionReason: nr.exclusionReason,
          error: nr.error,
          createdAt: n.createdAt,
          sentAt: nr.sentAt,
          openTracked: nr.openTracked,
          firstOpenedAt: nr.firstOpenedAt,
          openCount: nr.openCount,
        })
        .from(nr)
        .innerJoin(n, eq(n.notificationId, nr.notificationId))
        .where(where)
        .orderBy(desc(n.createdAt), desc(nr.notificationId))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ value: count() }).from(nr).innerJoin(n, eq(n.notificationId, nr.notificationId)).where(where),
    ]);
    return {
      rows: rows.map((row) => ({
        ...row,
        notificationId: row.notificationId as TemplateRecipientRow['notificationId'],
        topicId: row.topicId as TemplateRecipientRow['topicId'],
        templateVersionId: row.templateVersionId as TemplateVersionId,
        userId: row.userId as UserId,
      })),
      total: total?.value ?? 0,
    };
  }

  async countByVersion(appId: AppId, range: TimeRange): Promise<VersionSendCount[]> {
    const rows = await this.transactions
      .executor()
      .select({
        templateVersionId: n.templateVersionId,
        sent: countIf(eq(nr.status, 'sent')),
        tracked: countIf(and(eq(nr.status, 'sent'), eq(nr.openTracked, true))!),
        opened: countIf(and(eq(nr.status, 'sent'), eq(nr.openTracked, true), isNotNull(nr.firstOpenedAt))!),
      })
      .from(nr)
      .innerJoin(n, eq(n.notificationId, nr.notificationId))
      .where(and(eq(n.appId, appId), isNotNull(n.templateVersionId), gte(n.createdAt, range.from), lt(n.createdAt, range.to)))
      .groupBy(n.templateVersionId);
    return rows.map((row) => ({ ...row, templateVersionId: row.templateVersionId as TemplateVersionId }));
  }
}

const BUCKET: Record<RecipientBucket, () => SQL | undefined> = {
  sent: () => eq(nr.status, 'sent'),
  opened: () => and(eq(nr.status, 'sent'), eq(nr.openTracked, true), isNotNull(nr.firstOpenedAt)),
  unopened: () => and(eq(nr.status, 'sent'), eq(nr.openTracked, true), isNull(nr.firstOpenedAt)),
  failed: () => inArray(nr.status, ['failed', 'bounced']),
  skipped: () => eq(nr.status, 'skipped'),
};

function scope(appId: AppId, versionIds: readonly TemplateVersionId[], range: TimeRange) {
  return and(
    eq(n.appId, appId),
    inArray(n.templateVersionId, [...versionIds]),
    gte(n.createdAt, range.from),
    lt(n.createdAt, range.to),
  );
}

/** `%` / `_` / `\` trong ô tìm là chữ thường, không phải ký tự đại diện. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
