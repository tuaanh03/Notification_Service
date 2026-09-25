import type { AppId, Clock, NotificationStatus } from '../../../../shared/kernel/index.ts';
import type { AppOverviewDto } from '../dto.ts';
import type { EmailCounts, NotificationStats, RecipientLookup, TopicConsentLookup } from '../ports/index.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HOURS = 24;

/** Trạng thái nào vào cột nào của biểu đồ theo giờ. Trạng thái khác (chưa dùng ở MVP) không vẽ. */
const HOURLY_COLUMN: Partial<Record<NotificationStatus, 'sent' | 'failed' | 'blocked' | 'pending'>> = {
  sent: 'sent',
  failed: 'failed',
  no_recipient: 'blocked',
  queued: 'pending',
  sending: 'pending',
};

/**
 * Màn Tổng quan của MỘT app (plan §5 — bề mặt đọc cho vận hành): gửi bao nhiêu, bao nhiêu lỗi / bị
 * chặn và vì sao, hàng chờ dài bao nhiêu, còn bao nhiêu người nhận được thư.
 *
 * Tốn cố định 8 truy vấn đếm, chạy song song, không phụ thuộc số lần gửi. Không trả nội dung thư,
 * địa chỉ hay mã người nhận — chỉ con số.
 *
 * Thư trả về (bounce) CHƯA có: NDR còn nằm ở hộp thư gửi, EWS chưa đọc (ADR-0018).
 */
export class GetAppOverview {
  private readonly deps: {
    clock: Clock;
    stats: NotificationStats;
    users: RecipientLookup;
    emails: EmailCounts;
    topics: TopicConsentLookup;
  };

  constructor(deps: GetAppOverview['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId }): Promise<AppOverviewDto> {
    const { clock, stats, users, emails, topics } = this.deps;
    const now = clock.now();
    const window = { from: new Date(now.getTime() - DAY_MS), to: now };
    const previous = { from: new Date(window.from.getTime() - DAY_MS), to: window.from };
    const firstHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - (HOURS - 1) * HOUR_MS;

    const [byStatus, previousByStatus, hourlyRows, blocked, backlog, userTotal, emailCounts, appTopics] = await Promise.all([
      stats.countByStatus(input.appId, window),
      stats.countByStatus(input.appId, previous),
      stats.countByHour(input.appId, { from: new Date(firstHour), to: now }),
      stats.countExclusions(input.appId, window),
      stats.backlog(input.appId),
      users.countUsers(input.appId),
      emails.countByStatus(input.appId),
      topics.topicsByApp(input.appId),
    ]);

    const hourly = Array.from({ length: HOURS }, (_, i) => ({
      hour: new Date(firstHour + i * HOUR_MS).toISOString(),
      sent: 0,
      failed: 0,
      blocked: 0,
      pending: 0,
    }));
    for (const row of hourlyRows) {
      const column = HOURLY_COLUMN[row.status];
      const bucket = hourly[Math.round((row.hour.getTime() - firstHour) / HOUR_MS)];
      if (column && bucket) bucket[column] += row.count;
    }

    return {
      generatedAt: now.toISOString(),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      sends: { total: sum(byStatus), previousTotal: sum(previousByStatus) },
      byStatus,
      blocked,
      hourly,
      queue: { waiting: backlog.waiting, oldestCreatedAt: backlog.oldestCreatedAt?.toISOString() ?? null },
      recipients: {
        total: userTotal,
        emailActive: emailCounts.active,
        emailUnsubscribed: emailCounts.unsubscribed,
        emailInvalid: emailCounts.invalid,
      },
      topics: { total: appTopics.length, active: appTopics.filter((topic) => topic.status === 'active').length },
    };
  }
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);
