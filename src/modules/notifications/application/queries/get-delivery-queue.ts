import type { AppId, Clock } from '../../../../shared/kernel/index.ts';
import type { DeliveryQueueDto } from '../dto.ts';
import type { AppLabelLookup, IngressLimitsLookup, MailboxDayQuota, NotificationStats } from '../ports/index.ts';

/**
 * Màn Hàng chờ gửi của Super Admin (ADR-0041): hộp gửi chung còn bao nhiêu lượt hôm nay, app nào đang chiếm hàng chờ,
 * thư mới xếp vào phải đợi khoảng bao lâu. Cố định 3 truy vấn + 1 lần đọc Redis + một lần tra tên mỗi app đang có thư chờ.
 *
 * Thời gian chờ ước tính = thư `queued` + `sending` của MỌI app chia cho lượt mỗi phút của làn thường — hàng `notif.queued`
 * là FIFO chung. Tin bắt buộc đi làn riêng nên chờ ít hơn con số này.
 */
export class GetDeliveryQueue {
  private readonly deps: {
    clock: Clock;
    stats: NotificationStats;
    mailbox: MailboxDayQuota;
    limits: IngressLimitsLookup;
    apps: AppLabelLookup;
    /** `EMAIL_MAX_PER_MINUTE` / `EMAIL_PRIORITY_RESERVE_PER_MINUTE` — cấu hình process, không phải cài đặt console. */
    perMinute: number;
    priorityReservePerMinute: number;
  };

  constructor(deps: GetDeliveryQueue['deps']) {
    this.deps = deps;
  }

  async execute(): Promise<DeliveryQueueDto> {
    const { clock, stats, mailbox, limits, apps, perMinute, priorityReservePerMinute } = this.deps;
    const now = clock.now();
    const [rows, usedToday, settings] = await Promise.all([stats.pendingByApp(), mailbox.used(now), limits.current()]);

    const byApp = new Map<AppId, DeliveryQueueDto['apps'][number]>();
    for (const row of rows) {
      const entry = byApp.get(row.appId) ?? {
        appId: row.appId,
        name: '',
        slug: '',
        scheduled: 0,
        queued: 0,
        sending: 0,
        oldestQueuedAt: null,
      };
      entry[row.status] = row.count;
      if (row.status !== 'scheduled' && row.oldestCreatedAt) {
        const oldest = row.oldestCreatedAt.toISOString();
        if (entry.oldestQueuedAt === null || oldest < entry.oldestQueuedAt) entry.oldestQueuedAt = oldest;
      }
      byApp.set(row.appId, entry);
    }
    await Promise.all(
      [...byApp].map(async ([appId, entry]) => {
        const label = await apps.labelOf(appId);
        entry.name = label?.name ?? '';
        entry.slug = label?.slug ?? '';
      }),
    );
    const list = [...byApp.values()];
    list.sort((a, b) => b.queued + b.sending + b.scheduled - (a.queued + a.sending + a.scheduled));

    const waiting = list.reduce((sum, a) => sum + a.queued + a.sending, 0);
    const normalPerMinute = Math.max(1, perMinute - priorityReservePerMinute);
    return {
      mailbox: { usedToday, dailyCap: settings.mailboxDailyCap, perMinute, priorityReservePerMinute },
      maxPendingPerApp: settings.maxPendingPerApp,
      waiting,
      scheduled: list.reduce((sum, a) => sum + a.scheduled, 0),
      estimatedWaitMinutes: Math.ceil(waiting / normalPerMinute),
      apps: list,
    };
  }
}
