import { type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  ConcurrentTransitionError,
  ValidationError,
  type AppId,
  type Clock,
  type ExclusionReason,
  type NotificationId,
} from '../../../../shared/kernel/index.ts';
import type { Logger } from '../../../../shared/observability/logger.ts';
import type { Notification } from '../../domain/entities/notification.ts';
import { NotificationRecipient } from '../../domain/entities/notification-recipient.ts';
import { addCounters } from '../../domain/rules/counters.ts';
import { emailGate } from '../../domain/rules/email-gate.ts';
import type { Counters } from '../../domain/types/counters.ts';
import { EMAIL_SENDER_ACTOR, NOTIFICATION_AGGREGATE, NOTIFICATION_EVENTS, OUTCOME_UNKNOWN } from '../events.ts';
import type {
  EmailDeliveryOutcome,
  EmailLookup,
  EmailSender,
  NotificationRepository,
  RecipientRepository,
  TopicConsentLookup,
} from '../ports/index.ts';

export type DeliveryOutcome = 'skipped' | 'no_recipient' | 'sent' | 'failed';

/**
 * Những gì biết thêm được dọc đường, CHỈ để ghi log (ĐX-0001) — không nhánh nào đọc để quyết định.
 * Rỗng ở bước 0: notification không còn `queued` thì chưa tra được app hay topic.
 */
interface DeliveryTrace {
  appId?: AppId | undefined;
  topic?: string | undefined;
  exclusionReason?: ExclusionReason | undefined;
  providerResult?: EmailDeliveryOutcome['kind'] | undefined;
}

/** Lý do bị gate chặn -> ô counters tương ứng. */
const COUNTER_OF: Record<ExclusionReason, Partial<Counters>> = {
  no_channel: { noChannel: 1 },
  opted_out: { optedOut: 1 },
  opted_out_optional: { optedOut: 1 },
  invalid: { skipped: 1 },
  suppressed: { skipped: 1 },
  excluded: { skipped: 1 },
  duplicate: { skipped: 1 },
};

/**
 * Worker `email-sender`: gửi MỘT notification, AT-MOST-ONCE (ADR-0016 D3, implementation_plan.md §7).
 *
 *   0. Không còn `queued` -> không làm gì (message giao lại / worker khác đã xử lý).
 *   1. Gate (L0/L1/L3) với dữ liệu MỚI NHẤT — consent có thể đã đổi kể từ lúc xếp hàng.
 *      Bị chặn -> `queued -> no_recipient` + lý do. Xong.
 *   2. Chờ lượt gửi (giới hạn tốc độ), rồi tx1 "nhận việc": `queued -> sending` CÓ ĐIỀU KIỆN, COMMIT. Thua (ConcurrentTransition) -> dừng:
 *      worker khác đã nhận, chỉ một bên được gửi.
 *   3. Gọi provider NGOÀI transaction (delivery tự thử lại khi chắc chắn chưa gửi).
 *   4. tx2: `sending -> sent | failed`.
 *
 * Chết giữa 2 và 4: message giao lại thấy `sending` -> bước 0 bỏ qua; job fail-stuck-sending chốt
 * `failed / outcome_unknown`. Không có đường nào gửi lần hai.
 */
export class DeliverEmailNotification {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    logger: Logger;
    notifications: NotificationRepository;
    recipients: RecipientRepository;
    emails: EmailLookup;
    topics: TopicConsentLookup;
    sender: EmailSender;
  };

  constructor(deps: DeliverEmailNotification['deps']) {
    this.deps = deps;
  }

  async execute(id: NotificationId): Promise<DeliveryOutcome> {
    const log = this.deps.logger.child('deliver-email');
    const startedAt = this.deps.clock.now();
    const trace: DeliveryTrace = {};
    const outcome = await this.deliver(id, trace, log);
    // MỘT dòng cho mọi lần worker chạm vào notification, đủ mọi nhánh DeliveryOutcome (ĐX-0001).
    // Trước đây chỉ MockEmailProvider ghi log, nên đường gửi thật qua Graph hoàn toàn im lặng.
    // KHÔNG ghi địa chỉ, tiêu đề hay nội dung thư: log đi xa hơn database, đó là dữ liệu cá nhân.
    // Tên provider không lấy qua port `EmailSender` (port nghiệp vụ, không phải chỗ khai báo hạ tầng)
    // — mỗi worker đã ghi `email provider selected` lúc khởi động, ghép theo process là ra.
    log.info('email delivery finished', {
      notification_id: id,
      app_id: trace.appId ?? null,
      topic: trace.topic ?? null,
      outcome,
      provider_result: trace.providerResult ?? null,
      exclusion_reason: trace.exclusionReason ?? null,
      duration_ms: this.deps.clock.now().getTime() - startedAt.getTime(),
    });
    return outcome;
  }

  private async deliver(id: NotificationId, trace: DeliveryTrace, log: Logger): Promise<DeliveryOutcome> {
    const { clock, notifications, recipients, emails, topics, sender } = this.deps;

    // --- 0 ---
    const notification = await notifications.findById(id);
    if (!notification || notification.status !== 'queued') return 'skipped';
    trace.appId = notification.appId;
    const { targetUserId: userId, content } = notification;
    if (!userId || !content) {
      // Không phải email gửi trực tiếp — MVP chưa có đường gửi khác. Tất định -> DLQ.
      throw ValidationError.of('NOT_DIRECT_EMAIL', `notification ${id} has no direct recipient or content`);
    }

    // --- 1 ---
    const topic = await topics.topicById(notification.topicId);
    if (!topic) throw ValidationError.of('TOPIC_NOT_FOUND', `topic of notification ${id} no longer exists`);
    trace.topic = topic.key;
    const email = await emails.find(notification.appId, userId);
    const gate = emailGate({
      subscription: email,
      topic,
      preference: await topics.preference(userId, topic.topicId),
    });
    const recipientProps = {
      notificationId: notification.id,
      userId,
      channel: 'email' as const,
      subscriptionId: email?.subscriptionId ?? null,
      // Không có email: vẫn ghi dòng người nhận để trả lời "vì sao không gửi" — địa chỉ rỗng.
      address: email?.address ?? '',
      includedVia: 'direct' as const,
    };

    if (!gate.allowed) {
      trace.exclusionReason = gate.reason;
      const won = await this.transition(notification, 'zero_recipients', gate.reason, async () => {
        notification.counters = addCounters(notification.counters, { resolved: 1, ...COUNTER_OF[gate.reason] });
        await recipients.insert(
          new NotificationRecipient({ ...recipientProps, exclusionReason: gate.reason, status: 'skipped' }),
        );
        return { eventType: NOTIFICATION_EVENTS.noRecipient, after: { status: 'no_recipient', reason: gate.reason } };
      });
      return won ? 'no_recipient' : 'skipped';
    }

    // --- 2: chờ lượt gửi, rồi tx1 nhận việc ---
    await sender.awaitCapacity();
    const recipient = new NotificationRecipient(recipientProps);
    const claimed = await this.transition(notification, 'first_batch_left', null, async () => {
      notification.counters = addCounters(notification.counters, { resolved: 1 });
      await recipients.insert(recipient);
      return null; // không phát event: "đang gửi" không phải kết quả
    });
    if (!claimed) return 'skipped';

    // --- 3: ngoài transaction ---
    const result = await sender.send({
      to: recipient.address,
      subject: content.subject,
      html: content.html,
      text: content.text,
      notificationId: notification.id,
    });

    // --- 4: tx2, ghi kết quả ---
    trace.providerResult = result.kind;
    const now = clock.now();
    if (result.kind === 'accepted') {
      recipient.markSent(result.providerMessageId, now);
    } else {
      recipient.markFailed((result.kind === 'unknown' ? `${OUTCOME_UNKNOWN}: ${result.reason}` : result.reason).slice(0, 500));
    }
    const finished = await this.transition(
      notification,
      result.kind === 'accepted' ? 'all_accepted' : 'all_failed',
      result.kind === 'accepted' ? null : recipient.error,
      async () => {
        notification.counters = addCounters(notification.counters, result.kind === 'accepted' ? { sent: 1 } : { failed: 1 });
        await recipients.update(recipient);
        return result.kind === 'accepted'
          ? { eventType: NOTIFICATION_EVENTS.sent, after: { status: 'sent', providerMessageId: result.providerMessageId } }
          : { eventType: NOTIFICATION_EVENTS.failed, after: { status: 'failed', error: recipient.error } };
      },
    );
    if (!finished) {
      // Job fail-stuck-sending đã chốt `failed / outcome_unknown` trước. Trạng thái kết thúc không đổi được.
      log.warn('notification finished elsewhere while sending', { notification_id: id, provider_result: result.kind });
      return 'skipped';
    }
    return result.kind === 'accepted' ? 'sent' : 'failed';
  }

  /**
   * Một chuyển trạng thái = một transaction: apply -> ghi có điều kiện -> việc kèm theo -> event.
   * Trả false nếu bên khác đã đổi trạng thái trước (thua race) — không phải lỗi.
   */
  private async transition(
    notification: Notification,
    event: 'zero_recipients' | 'first_batch_left' | 'all_accepted' | 'all_failed',
    reason: string | null,
    work: () => Promise<{ eventType: string; after: Record<string, unknown> } | null>,
  ): Promise<boolean> {
    const { uow, outbox, clock, notifications } = this.deps;
    try {
      await uow.run(async () => {
        notification.apply(event, EMAIL_SENDER_ACTOR, clock.now(), reason ?? undefined);
        await notifications.saveTransition(notification);
        const emitted = await work();
        if (emitted) {
          await outbox.append([
            {
              aggregateType: NOTIFICATION_AGGREGATE,
              aggregateId: notification.id,
              eventType: emitted.eventType,
              payload: { actor: EMAIL_SENDER_ACTOR, source: 'worker', after: emitted.after },
            },
          ]);
        }
      });
      return true;
    } catch (err) {
      if (err instanceof ConcurrentTransitionError) return false;
      throw err;
    }
  }
}
