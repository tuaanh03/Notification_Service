import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  NotificationId,
  ValidationError,
  type AppId,
  type Channel,
  type Clock,
  type TemplateId,
} from '../../../../shared/kernel/index.ts';
import { Notification } from '../../domain/entities/notification.ts';
import { emailContent, type EmailContent } from '../../domain/types/email-content.ts';
import { toNotificationDto, type NotificationDto } from '../dto.ts';
import { IdempotencyKeyTakenError } from '../errors.ts';
import { templateLabelOf } from '../queries/get-notification.ts';
import { NOTIFICATION_AGGREGATE, NOTIFICATION_EVENTS } from '../events.ts';
import type {
  NotificationRepository,
  RecipientLookup,
  RecipientRepository,
  TemplateLabel,
  TemplateLabels,
  TemplateRenderer,
  TopicConsentLookup,
} from '../ports/index.ts';

export interface AcceptEmailNotificationInput {
  appId: AppId;
  grantedChannels: readonly Channel[];
  externalId: string;
  topic: string;
  /** Cách 1 — nội dung viết thẳng. */
  subject?: string | undefined;
  html?: string | undefined;
  text?: string | undefined;
  /** Cách 2 — gửi bằng template đã xuất bản (ADR-0020). Loại trừ với cách 1. */
  templateId?: TemplateId | undefined;
  payload?: Record<string, unknown> | undefined;
  idempotencyKey?: string | undefined;
}

/**
 * `POST /v1/notifications` — nhận một email và XẾP HÀNG. Không gửi, không kiểm consent
 * (worker kiểm ngay trước lúc gửi — ADR-0016 D7). Chỉ chặn lỗi input:
 *   CHANNEL_NOT_GRANTED · CONTENT_AND_TEMPLATE_CONFLICT · PAYLOAD_REQUIRES_TEMPLATE · nội dung sai
 *   (EmailContent) · TOPIC_NOT_FOUND · TOPIC_NOT_ACTIVE · RECIPIENT_NOT_FOUND · lỗi của template
 *   (TEMPLATE_NOT_FOUND / _NOT_PUBLISHED / _ARCHIVED · MISSING_VARIABLE · INVALID_PAYLOAD_VALUE · LINK_SCHEME_NOT_ALLOWED)
 *
 * Gửi bằng template: đổ biến NGAY Ở ĐÂY (ADR-0020), lưu nội dung đã đổ + `template_version_id` + `payload`.
 * Worker gửi y như nội dung viết thẳng. Admin xuất bản bản mới sau đó không đổi thư đã nhận.
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
    renderer: TemplateRenderer;
    templates: TemplateLabels;
  };

  constructor(deps: AcceptEmailNotification['deps']) {
    this.deps = deps;
  }

  async execute(
    input: AcceptEmailNotificationInput,
    ctx: CommandContext,
  ): Promise<{ notification: NotificationDto; created: boolean }> {
    const { uow, outbox, clock, notifications, users, topics, renderer } = this.deps;
    if (!input.grantedChannels.includes('email')) {
      throw ValidationError.of('CHANNEL_NOT_GRANTED', 'this app is not granted the email channel', 'channel');
    }
    const templateId = input.templateId;
    if (templateId && [input.subject, input.html, input.text].some((field) => field !== undefined)) {
      throw ValidationError.of(
        'CONTENT_AND_TEMPLATE_CONFLICT',
        'send either templateId + payload or subject + html, not both',
        'templateId',
      );
    }
    if (!templateId && input.payload !== undefined) {
      throw ValidationError.of('PAYLOAD_REQUIRES_TEMPLATE', 'payload is only used together with templateId', 'payload');
    }
    // Nội dung viết thẳng kiểm ngay; nội dung từ template kiểm sau khi đổ biến (cùng `emailContent()`).
    const source = templateId
      ? ({ kind: 'template', templateId } as const)
      : ({
          kind: 'direct',
          content: emailContent({ subject: input.subject ?? '', html: input.html ?? '', text: input.text }),
        } as const);

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

    let content: EmailContent;
    let template: (TemplateLabel & { templateVersionId: NonNullable<Notification['templateVersionId']> }) | null = null;
    if (source.kind === 'template') {
      const rendered = await renderer.render({
        appId: input.appId,
        templateId: source.templateId,
        payload: input.payload ?? {},
        externalId: input.externalId,
      });
      content = emailContent(rendered);
      template = rendered;
    } else {
      content = source.content;
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
        templateVersionId: template?.templateVersionId ?? null,
        payload: input.payload ?? {},
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
          payload: audited(ctx, {
            after: {
              status: 'queued',
              topic: topic.key,
              channel: 'email',
              ...(template ? { template: { id: template.templateId, version: template.version } } : {}),
            },
          }),
        },
      ]);
      return {
        notification: toNotificationDto(notification, { topicKey: topic.key, recipient: null, template }),
        created: true,
      };
    });
  }

  private async describe(n: Notification): Promise<NotificationDto> {
    const topic = await this.deps.topics.topicById(n.topicId);
    return toNotificationDto(n, {
      topicKey: topic?.key ?? '',
      recipient: await this.deps.recipients.findByNotification(n.id),
      template: await templateLabelOf(this.deps.templates, n.templateVersionId),
    });
  }
}
