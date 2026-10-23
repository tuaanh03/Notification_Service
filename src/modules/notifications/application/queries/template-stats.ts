import {
  NotFoundError,
  type AppId,
  type Clock,
  type ExclusionReason,
  type TemplateId,
  type TemplateVersionId,
} from '../../../../shared/kernel/index.ts';
import type {
  TemplateRecipientPageDto,
  TemplateSendStatsListDto,
  TemplateStatsDto,
} from '../dto.ts';
import type {
  RecipientBucket,
  RecipientLookup,
  TemplateLabels,
  TemplateStats,
  TemplateVersionLookup,
  TemplateVersionMark,
  TimeRange,
  TopicConsentLookup,
} from '../ports/index.ts';

/** Khoảng xem được trên màn (UX-24). Chỉ những giá trị này — không mở thành truy vấn tuỳ ý cả lịch sử. */
export const TEMPLATE_STATS_DAYS = [7, 30, 90] as const;
export type TemplateStatsDays = (typeof TEMPLATE_STATS_DAYS)[number];
export const MAX_TEMPLATE_RECIPIENT_PAGE = 100;

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * `days` ngày giờ Việt Nam tính tới hôm nay: từ 00:00 (giờ VN) của ngày đầu tới bây giờ. Biểu đồ có đúng
 * `days` cột, cột cuối là hôm nay (chưa hết ngày).
 */
export function vnDayRange(now: Date, days: number): TimeRange & { firstDay: number } {
  const today = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS);
  const firstDay = today - days + 1;
  return { from: new Date(firstDay * DAY_MS - VN_OFFSET_MS), to: now, firstDay };
}

/** Số ngày kể từ epoch (theo giờ VN) -> `YYYY-MM-DD` của ngày đó ở Việt Nam. */
export const vnDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Số liệu MỘT template (UX-24) — chỉ những gì EWS đo thật:
 *  - "đã chuyển đi" = Microsoft 365 đã nhận thư (202), KHÔNG phải đã vào hộp; thư trả về chưa đo (ADR-0018);
 *  - "đã mở" là ước lượng bằng ảnh theo dõi (ADR-0031), mẫu số là thư CÓ chèn ảnh;
 *  - lượt bấm link không đo (endpoint công khai chưa ổn định — ghi ở ADR-0031).
 * Cộng qua mọi version, hoặc chỉ một version khi `version` có giá trị. 4 truy vấn cố định.
 */
export class GetTemplateStats {
  private readonly deps: { clock: Clock; stats: TemplateStats; versions: TemplateVersionLookup };

  constructor(deps: GetTemplateStats['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; templateId: TemplateId; days: TemplateStatsDays; version?: number | undefined }): Promise<TemplateStatsDto> {
    const { clock, stats } = this.deps;
    const versions = await versionsOrThrow(this.deps.versions, input.appId, input.templateId);
    const range = vnDayRange(clock.now(), input.days);
    const ids = selectedIds(versions, input.version);

    const [byStatus, byDay, opensByDay] = await Promise.all([
      stats.countByStatus(input.appId, ids, range),
      stats.countByDay(input.appId, ids, range),
      stats.opensByDay(input.appId, ids, range),
    ]);

    const summary = { total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 };
    const skippedByReason: Partial<Record<ExclusionReason, number>> = {};
    const opens = { tracked: 0, opened: 0, total: 0 };
    for (const row of byStatus) {
      summary.total += row.count;
      const key = row.status === 'bounced' ? 'failed' : row.status;
      summary[key] += row.count;
      if (row.status === 'skipped' && row.reason !== null) skippedByReason[row.reason] = (skippedByReason[row.reason] ?? 0) + row.count;
      opens.tracked += row.tracked;
      opens.opened += row.opened;
      opens.total += row.opens;
    }

    const series = Array.from({ length: input.days }, (_, i) => ({ date: vnDate(range.firstDay + i), sent: 0, failed: 0, skipped: 0, opened: 0 }));
    for (const row of byDay) {
      const bucket = series[row.day - range.firstDay];
      if (!bucket || row.status === 'pending') continue;
      bucket[row.status === 'bounced' ? 'failed' : row.status] += row.count;
    }
    for (const row of opensByDay) {
      // Thư gửi trong khoảng nhưng mở SAU hôm nay không thể có; mở trước ngày đầu cũng không. Bỏ qua cho chắc.
      const bucket = series[row.day - range.firstDay];
      if (bucket) bucket.opened += row.count;
    }

    return {
      window: { from: range.from.toISOString(), to: range.to.toISOString(), days: input.days },
      version: input.version ?? null,
      versions: versions.map((v) => ({ id: v.templateVersionId, version: v.version, publishedAt: v.publishedAt?.toISOString() ?? null })),
      summary: { ...summary, skippedByReason },
      opens,
      buckets: {
        sent: summary.sent,
        opened: opens.opened,
        unopened: opens.tracked - opens.opened,
        failed: summary.failed,
        skipped: summary.skipped,
      },
      series,
    };
  }
}

/** Người nhận của một template theo tab (UX-24). Một trang + đếm, rồi mã người nhận theo lô. */
export class ListTemplateRecipients {
  private readonly deps: {
    clock: Clock;
    stats: TemplateStats;
    versions: TemplateVersionLookup;
    users: RecipientLookup;
    topics: TopicConsentLookup;
  };

  constructor(deps: ListTemplateRecipients['deps']) {
    this.deps = deps;
  }

  async execute(input: {
    appId: AppId;
    templateId: TemplateId;
    days: TemplateStatsDays;
    version?: number | undefined;
    bucket: RecipientBucket;
    search?: string | undefined;
    limit: number;
    offset: number;
  }): Promise<TemplateRecipientPageDto> {
    const { clock, stats, users, topics } = this.deps;
    const versions = await versionsOrThrow(this.deps.versions, input.appId, input.templateId);
    const limit = Math.min(input.limit, MAX_TEMPLATE_RECIPIENT_PAGE);
    const page = await stats.listRecipients(
      input.appId,
      selectedIds(versions, input.version),
      vnDayRange(clock.now(), input.days),
      { bucket: input.bucket, search: input.search },
      { limit, offset: input.offset },
    );
    const [externalIds, appTopics] = await Promise.all([
      users.externalIds(input.appId, [...new Set(page.rows.map((row) => row.userId))]),
      topics.topicsByApp(input.appId),
    ]);
    const topicKeys = new Map(appTopics.map((topic) => [topic.topicId, topic.key] as const));
    const versionOf = new Map(versions.map((v) => [v.templateVersionId, v.version] as const));

    return {
      rows: page.rows.map((row) => ({
        notificationId: row.notificationId,
        address: row.address,
        externalId: externalIds.get(row.userId) ?? null,
        topicKey: topicKeys.get(row.topicId) ?? null,
        version: versionOf.get(row.templateVersionId) ?? null,
        status: row.status,
        exclusionReason: row.exclusionReason,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        openTracked: row.openTracked,
        firstOpenedAt: row.firstOpenedAt?.toISOString() ?? null,
        openCount: row.openCount,
      })),
      total: page.total,
      limit,
      offset: input.offset,
    };
  }
}

/** Màn danh sách template: đã chuyển đi + mở theo từng template trong `days` ngày. 2 truy vấn. */
export class ListTemplateSendStats {
  private readonly deps: { clock: Clock; stats: TemplateStats; templates: TemplateLabels };

  constructor(deps: ListTemplateSendStats['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; days: TemplateStatsDays }): Promise<TemplateSendStatsListDto> {
    const rows = await this.deps.stats.countByVersion(input.appId, vnDayRange(this.deps.clock.now(), input.days));
    const labels = await this.deps.templates.labelsOf(rows.map((row) => row.templateVersionId));
    const byTemplate = new Map<string, { templateId: string; sent: number; tracked: number; opened: number }>();
    for (const row of rows) {
      const templateId = labels.get(row.templateVersionId)?.templateId;
      if (!templateId) continue;
      const entry = byTemplate.get(templateId) ?? { templateId, sent: 0, tracked: 0, opened: 0 };
      entry.sent += row.sent;
      entry.tracked += row.tracked;
      entry.opened += row.opened;
      byTemplate.set(templateId, entry);
    }
    return { days: input.days, rows: [...byTemplate.values()] };
  }
}

async function versionsOrThrow(lookup: TemplateVersionLookup, appId: AppId, templateId: TemplateId): Promise<TemplateVersionMark[]> {
  const versions = await lookup.versionsOf(appId, templateId);
  if (!versions) throw new NotFoundError('template', templateId);
  return versions;
}

/** Một version cụ thể (không có -> rỗng, không 404: là bộ lọc) hoặc mọi version. */
function selectedIds(versions: readonly TemplateVersionMark[], version: number | undefined): TemplateVersionId[] {
  return versions.filter((v) => version === undefined || v.version === version).map((v) => v.templateVersionId);
}
