import type { EventOutbox, UnitOfWork } from '../../../../shared/application/index.ts';
import { ConcurrentTransitionError, type Clock } from '../../../../shared/kernel/index.ts';
import type { Logger } from '../../../../shared/observability/logger.ts';
import { addCounters } from '../../domain/rules/counters.ts';
import { EMAIL_SENDER_ACTOR, NOTIFICATION_AGGREGATE, NOTIFICATION_EVENTS, OUTCOME_UNKNOWN } from '../events.ts';
import type { NotificationRepository, RecipientRepository } from '../ports/index.ts';

/**
 * Job scheduler (mỗi phút): notification kẹt ở `sending` quá `stuckAfterMs` -> `failed / outcome_unknown`.
 *
 * Kẹt nghĩa là worker chết giữa "nhận việc" và "ghi kết quả" — KHÔNG biết thư đã đi hay chưa. Theo
 * at-most-once (ADR-0016 D3) thì không gửi lại; chốt `failed` để người vận hành kiểm tay qua
 * `GET /v1/notifications/:id`. Ghi có điều kiện theo status: chạy nhiều bản song song vẫn an toàn.
 */
export class FailStuckSending {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    logger: Logger;
    notifications: NotificationRepository;
    recipients: RecipientRepository;
    stuckAfterMs: number;
  };

  constructor(deps: FailStuckSending['deps']) {
    this.deps = deps;
  }

  /** Trả số notification đã chốt `failed`. */
  async execute(batchSize = 100): Promise<number> {
    const { uow, outbox, clock, notifications, recipients, stuckAfterMs } = this.deps;
    const now = clock.now();
    const stuck = await notifications.listStuckSending(new Date(now.getTime() - stuckAfterMs), batchSize);
    const reason = `${OUTCOME_UNKNOWN}: stuck in sending for more than ${Math.round(stuckAfterMs / 1000)}s`;

    let failed = 0;
    for (const notification of stuck) {
      try {
        await uow.run(async () => {
          notification.apply('all_failed', EMAIL_SENDER_ACTOR, now, reason);
          notification.counters = addCounters(notification.counters, { failed: 1 });
          await notifications.saveTransition(notification);
          const recipient = await recipients.findByNotification(notification.id);
          if (recipient) {
            recipient.markFailed(reason);
            await recipients.update(recipient);
          }
          await outbox.append([
            {
              aggregateType: NOTIFICATION_AGGREGATE,
              aggregateId: notification.id,
              eventType: NOTIFICATION_EVENTS.failed,
              payload: { actor: EMAIL_SENDER_ACTOR, source: 'scheduler', after: { status: 'failed', error: reason } },
            },
          ]);
        });
        failed += 1;
      } catch (err) {
        // Worker vừa kịp ghi kết quả, hoặc bản scheduler khác đã chốt — không phải lỗi.
        if (!(err instanceof ConcurrentTransitionError)) throw err;
      }
    }
    if (failed > 0) this.deps.logger.warn('stuck notifications failed as outcome_unknown', { count: failed });
    return failed;
  }
}
