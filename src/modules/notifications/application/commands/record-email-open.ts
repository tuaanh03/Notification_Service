import type { CommandSource, EventOutbox, UnitOfWork } from '../../../../shared/application/index.ts';
import { NotificationId, type Clock } from '../../../../shared/kernel/index.ts';
import { NOTIFICATION_AGGREGATE, NOTIFICATION_EVENTS, OPEN_TRACKING_ACTOR } from '../events.ts';
import type { OpenTrackingSigner, RecipientRepository } from '../ports/index.ts';

/**
 * `GET /t/o/:notificationId/:sig.gif` — ứng dụng mail tải ảnh theo dõi (ADR-0031). Chữ ký sai, id lạ,
 * thư chưa `sent` -> không ghi gì; route vẫn trả ảnh như thường để không lộ URL nào là thật.
 *
 * Lần mở ĐẦU TIÊN phát `NotificationOpened` (cùng transaction với lượt ghi) -> webhook `notification.opened`.
 * Mở lại không phát gì: app chỉ cần biết "đã mở", không cần mỗi lần ứng dụng mail tải lại ảnh.
 */
export class RecordEmailOpen {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    signer: OpenTrackingSigner;
    recipients: RecipientRepository;
  };

  constructor(deps: RecordEmailOpen['deps']) {
    this.deps = deps;
  }

  async execute(input: { notificationId: string; signature: string }): Promise<boolean> {
    const { uow, outbox, clock, signer, recipients } = this.deps;
    if (!signer.configured || !NotificationId.is(input.notificationId)) return false;
    const id = NotificationId.parse(input.notificationId);
    if (!signer.verify(id, input.signature)) return false;
    const at = clock.now();
    return uow.run(async () => {
      const result = await recipients.recordOpen(id, at);
      if (result === 'first') {
        await outbox.append([
          {
            aggregateType: NOTIFICATION_AGGREGATE,
            aggregateId: id,
            eventType: NOTIFICATION_EVENTS.opened,
            payload: { actor: OPEN_TRACKING_ACTOR, source: 'open_tracking' satisfies CommandSource, after: { openedAt: at.toISOString() } },
          },
        ]);
      }
      return result !== null;
    });
  }
}
