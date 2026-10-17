import type { EventOutbox, UnitOfWork } from '../../../../shared/application/index.ts';
import { ConcurrentTransitionError, type Clock } from '../../../../shared/kernel/index.ts';
import type { Logger } from '../../../../shared/observability/logger.ts';
import { NOTIFICATION_AGGREGATE, NOTIFICATION_EVENTS, SEND_WINDOW_ACTOR } from '../events.ts';
import type { NotificationRepository } from '../ports/index.ts';

/**
 * Job scheduler: thư `scheduled` đã tới giờ (khung giờ gửi vừa mở — ADR-0032) -> `queued` + `NotificationQueued`,
 * worker gửi như thư thường (kiểm consent lại lúc gửi). Ghi có điều kiện theo status: nhiều bản chạy song
 * song vẫn chỉ một bản thả được mỗi thư.
 *
 * Không xét lại khung giờ: thư hẹn 08:00 thì 08:00 đi, kể cả khi app vừa đổi khung — giờ hẹn là của lúc nhận.
 */
export class PromoteScheduled {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    logger: Logger;
    notifications: NotificationRepository;
  };

  constructor(deps: PromoteScheduled['deps']) {
    this.deps = deps;
  }

  /** Trả số thư đã thả. Mỗi lần gọi thả tối đa `batchSize`; còn thì nhịp sau thả tiếp. */
  async execute(batchSize = 500): Promise<number> {
    const { uow, outbox, clock, notifications } = this.deps;
    const now = clock.now();
    const due = await notifications.listDueScheduled(now, batchSize);

    let promoted = 0;
    for (const notification of due) {
      try {
        await uow.run(async () => {
          notification.apply('due', SEND_WINDOW_ACTOR, now);
          await notifications.saveTransition(notification);
          await outbox.append([
            {
              aggregateType: NOTIFICATION_AGGREGATE,
              aggregateId: notification.id,
              eventType: NOTIFICATION_EVENTS.queued,
              payload: { actor: SEND_WINDOW_ACTOR, source: 'scheduler', after: { status: 'queued' } },
            },
          ]);
        });
        promoted += 1;
      } catch (err) {
        // Bản scheduler khác đã thả trước — không phải lỗi.
        if (!(err instanceof ConcurrentTransitionError)) throw err;
      }
    }
    if (promoted > 0) this.deps.logger.info('scheduled notifications promoted', { count: promoted });
    return promoted;
  }
}
