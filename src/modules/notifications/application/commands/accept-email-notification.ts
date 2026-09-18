import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  NotificationId,
  ValidationError,
  type AppId,
  type Channel,
  type Clock,
} from '../../../../shared/kernel/index.ts';
import { Notification } from '../../domain/entities/notification.ts';
import { emailContent } from '../../domain/types/email-content.ts';
import { toNotificationDto, type NotificationDto } from '../dto.ts';
import { IdempotencyKeyTakenError } from '../errors.ts';
import { NOTIFICATION_AGGREGATE, NOTIFICATION_EVENTS } from '../events.ts';
import type { NotificationRepository, RecipientLookup, RecipientRepository, TopicConsentLookup } from '../ports/index.ts';

export interface AcceptEmailNotificationInput {
  appId: AppId;
  grantedChannels: readonly Channel[];
  externalId: string;
  topic: string;
  subject: string;
  html: string;
  text?: string | undefined;
  idempotencyKey?: string | undefined;
}

/**
 * `POST /v1/notifications` — nhận một email gửi trực tiếp và XẾP HÀNG. Không gửi, không kiểm consent
 * (worker kiểm ngay trước lúc gửi — ADR-0016 D7). Chỉ chặn lỗi input:
 *   CHANNEL_NOT_GRANTED · nội dung sai (EmailContent) · TOPIC_NOT_FOUND · TOPIC_NOT_ACTIVE · RECIPIENT_NOT_FOUND
 *
 * Idempotency: trùng `idempotencyKey` trong app -> trả notification cũ (`created: false`, HTTP 200),
 * kể cả khi hai request đua nhau (unique index quyết định).
 */
export class AcceptEmailNotification {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    notifications: NotificationRepository;
    recipients: RecipientRepository;
    users: RecipientLookup;
    topics: TopicConsentLookup;
  };

  constructor(deps: AcceptEmailNotification['deps']) {
    this.deps = deps;
  }

  async execute(
    input: AcceptEmailNotificationInput,
    ctx: CommandContext,
  ): Promise<{ notification: NotificationDto; created: boolean }> {
    const { uow, outbox, clock, notifications, users, topics } = this.deps;
    if (!input.grantedChannels.includes('email')) {
      throw ValidationError.of('CHANNEL_NOT_GRANTED', 'this app is not granted the email channel', 'channel');
    }
    const content = emailContent({ subject: input.subject, html: input.html, text: input.text });

    if (input.idempotencyKey) {
      const existing = await notifications.findByIdempotencyKey(input.appId, input.idempotencyKey);
      if (existing) return { notification: await this.describe(existing), created: false };
    }

    const topic = await topics.topicByKey(input.appId, input.topic);
    if (!topic) throw ValidationError.of('TOPIC_NOT_FOUND', `topic ${input.topic} does not exist`, 'topic');
    if (topic.status !== 'active') {
      throw ValidationError.of('TOPIC_NOT_ACTIVE', `topic ${input.topic} is ${topic.status}`, 'topic');
    }
    const userId = await users.findUserId(input.appId, input.externalId);
    if (!userId) {
      throw ValidationError.of(
        'RECIPIENT_NOT_FOUND',
        `user ${input.externalId} does not exist: sync it first with PUT /v1/users/:externalId`,
        'to.externalId',
      );
    }

    return uow.run(async () => {
      const notification = new Notification({
        id: NotificationId.create(),
        appId: input.appId,
        topicId: topic.topicId,
        origin: 'api',
        idempotencyKey: input.idempotencyKey ?? null,
        targetUserId: userId,
        content,
        createdBy: ctx.actor.id,
        createdAt: clock.now(),
      });
      try {
        await notifications.insert(notification);
      } catch (err) {
        if (!(err instanceof IdempotencyKeyTakenError) || !input.idempotencyKey) throw err;
        const winner = await notifications.findByIdempotencyKey(input.appId, input.idempotencyKey);
        if (!winner) throw err;
        return { notification: await this.describe(winner), created: false };
      }
      await outbox.append([
        {
          aggregateType: NOTIFICATION_AGGREGATE,
          aggregateId: notification.id,
          eventType: NOTIFICATION_EVENTS.queued,
          payload: audited(ctx, { after: { status: 'queued', topic: topic.key, channel: 'email' } }),
        },
      ]);
      return { notification: toNotificationDto(notification, { topicKey: topic.key, recipient: null }), created: true };
    });
  }

  private async describe(n: Notification): Promise<NotificationDto> {
    const topic = await this.deps.topics.topicById(n.topicId);
    return toNotificationDto(n, {
      topicKey: topic?.key ?? '',
      recipient: await this.deps.recipients.findByNotification(n.id),
    });
  }
}
