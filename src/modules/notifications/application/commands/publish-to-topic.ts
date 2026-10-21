import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  NotificationId,
  PublicationId,
  ValidationError,
  type AppId,
  type Clock,
  type UserId,
} from '../../../../shared/kernel/index.ts';
import { Notification } from '../../domain/entities/notification.ts';
import { assertPublicationSize, Publication } from '../../domain/entities/publication.ts';
import { selectTopicAudience } from '../../domain/rules/topic-audience.ts';
import { emailContent, type EmailContent } from '../../domain/types/email-content.ts';
import type { PublicationDto } from '../dto.ts';
import { PublicationKeyTakenError } from '../errors.ts';
import { NOTIFICATION_AGGREGATE, NOTIFICATION_EVENTS, PUBLICATION_AGGREGATE, PUBLICATION_EVENTS } from '../events.ts';
import type {
  EmailLookup,
  NotificationRepository,
  PublicationRepository,
  RecipientLookup,
  RenderedEmailTemplate,
  SendPolicyLookup,
  SendQuota,
  SendSlotReserver,
  TemplateLabels,
  TemplateRenderer,
  TopicConsentLookup,
} from '../ports/index.ts';
import { describePublication } from '../queries/get-publication.ts';
import { parseSendSource, requireActiveTopic, type SendContentInput } from './send-input.ts';
import { planSendTimes, scheduleNote } from './send-timing.ts';

export interface PublishToTopicInput extends SendContentInput {
  appId: AppId;
  topic: string;
  /** Bắt buộc — thiếu là 422 IDEMPOTENCY_KEY_REQUIRED. Khai optional để lỗi đi đúng mã, không thành lỗi parse. */
  idempotencyKey?: string | undefined;
}

/**
 * `POST /v1/publications` — phát MỘT tin cho mọi người đang theo dõi topic trong app (ADR-0028).
 *
 * Người nhận chốt NGAY LÚC PHÁT bằng `selectTopicAudience` (cùng `emailGate` worker dùng), rồi mỗi người
 * thành một notification con `queued` (ngoài khung giờ gửi: `scheduled` — ADR-0032) đi đúng đường gửi lẻ: cùng worker, cùng at-most-once, worker kiểm
 * consent lại lần nữa ngay trước khi gửi. Lần phát và mọi thư con ghi trong MỘT transaction — hoặc đủ cả,
 * hoặc không có gì.
 *
 * Lỗi: như gửi lẻ (CHANNEL_NOT_GRANTED · CONTENT_AND_TEMPLATE_CONFLICT · PAYLOAD_REQUIRES_TEMPLATE · nội dung
 * sai · TOPIC_NOT_FOUND · TOPIC_NOT_ACTIVE · lỗi template) + IDEMPOTENCY_KEY_REQUIRED · PUBLICATION_TOO_LARGE.
 * Topic không ai theo dõi KHÔNG phải lỗi: lần phát vẫn ghi, `recipientCount: 0`.
 *
 * Topic bắt buộc phát được: app đã gửi lẻ tin bắt buộc được, chặn ở đây chỉ bắt app lặp gửi lẻ.
 */
export class PublishToTopic {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    publications: PublicationRepository;
    notifications: NotificationRepository;
    users: RecipientLookup;
    emails: EmailLookup;
    topics: TopicConsentLookup;
    renderer: TemplateRenderer;
    templates: TemplateLabels;
    policies: SendPolicyLookup;
    slots: SendSlotReserver;
    quota: SendQuota;
  };

  constructor(deps: PublishToTopic['deps']) {
    this.deps = deps;
  }

  async execute(input: PublishToTopicInput, ctx: CommandContext): Promise<{ publication: PublicationDto; created: boolean }> {
    const { uow, outbox, clock, publications, notifications, users, emails, topics } = this.deps;
    const source = parseSendSource(input);
    const idempotencyKey = input.idempotencyKey;
    if (!idempotencyKey) {
      throw ValidationError.of('IDEMPOTENCY_KEY_REQUIRED', 'a publication requires an idempotencyKey', 'idempotencyKey');
    }

    const existing = await publications.findByIdempotencyKey(input.appId, idempotencyKey);
    if (existing) return { publication: await describePublication(this.deps, existing), created: false };

    const topic = await requireActiveTopic(topics, input.appId, input.topic);

    // Người nhận: user có email trong app (người không có email chắc chắn rớt ở gate) + lựa chọn của họ cho topic.
    const [emailsByUser, deleted] = await Promise.all([emails.listByApp(input.appId), users.deletedUserIds(input.appId)]);
    // Người đã xoá mềm trên console: email vẫn còn (để khôi phục nguyên vẹn) nhưng không nhận tin.
    for (const userId of deleted) emailsByUser.delete(userId);
    const preferences = await topics.preferences(topic.topicId, [...emailsByUser.keys()]);
    const audience = selectTopicAudience(
      [...emailsByUser].map(([userId, subscription]) => ({ userId, subscription, preference: preferences.get(userId) ?? null })),
      topic,
    );
    assertPublicationSize(audience.length);
    const externalIds = await users.externalIds(input.appId, audience);

    // Template có biến `user.external_id` nên đổ biến TỪNG người. Đổ hết trước transaction: lỗi template là
    // 422 trước khi ghi gì. Không ai nhận vẫn đổ một lần để template sai không lọt qua im lặng.
    const contents = new Map<UserId, EmailContent>();
    let template: RenderedEmailTemplate | null = null;
    if (source.kind === 'template') {
      const render = (externalId: string) =>
        this.deps.renderer.render({
          appId: input.appId,
          templateId: source.templateId,
          payload: input.payload ?? {},
          externalId,
        });
      if (audience.length === 0) template = await render('');
      for (const userId of audience) {
        const rendered = await render(externalIds.get(userId) ?? '');
        contents.set(userId, emailContent(rendered));
        template ??= rendered;
      }
    }

    const now = clock.now();
    // Khung giờ + dàn đều (ADR-0032): mỗi thư con một giờ gửi riêng — dàn đều thì mỗi phút chỉ N thư.
    const timings = await planSendTimes(this.deps, input.appId, topic, now, audience.length);
    const publication = new Publication({
      id: PublicationId.create(),
      appId: input.appId,
      topicId: topic.topicId,
      idempotencyKey,
      recipientCount: audience.length,
      templateVersionId: template?.templateVersionId ?? null,
      createdBy: ctx.actor.id,
      createdAt: now,
    });
    const children = audience.map(
      (userId, i) =>
        new Notification({
          id: NotificationId.create(),
          appId: input.appId,
          topicId: topic.topicId,
          origin: input.origin ?? 'api',
          status: timings[i] ? 'scheduled' : 'queued',
          scheduledAt: timings[i]?.at ?? null,
          targetUserId: userId,
          publicationId: publication.id,
          content: source.kind === 'direct' ? source.content : (contents.get(userId) ?? null),
          templateVersionId: template?.templateVersionId ?? null,
          payload: input.payload ?? {},
          createdBy: ctx.actor.id,
          createdAt: now,
        }),
    );
    const templateLabel = template ? { template: { id: template.templateId, version: template.version } } : {};

    const created = await uow.run(async () => {
      try {
        await publications.insert(publication);
      } catch (err) {
        if (!(err instanceof PublicationKeyTakenError)) throw err;
        return false;
      }
      for (const child of children) await notifications.insert(child);
      await outbox.append([
        {
          aggregateType: PUBLICATION_AGGREGATE,
          aggregateId: publication.id,
          eventType: PUBLICATION_EVENTS.published,
          payload: audited(ctx, {
            after: {
              topic: topic.key,
              mandatory: topic.mandatory,
              recipientCount: audience.length,
              idempotencyKey,
              ...templateLabel,
            },
          }),
        },
        ...children.map((child, i) => ({
          aggregateType: NOTIFICATION_AGGREGATE,
          aggregateId: child.id,
          eventType: child.scheduledAt ? NOTIFICATION_EVENTS.scheduled : NOTIFICATION_EVENTS.queued,
          payload: audited(ctx, {
            after: {
              status: child.status,
              ...scheduleNote(timings[i] ?? null),
              topic: topic.key,
              channel: 'email',
              publicationId: publication.id,
              ...templateLabel,
            },
          }),
        })),
      ]);
      return true;
    });

    if (!created) {
      // Thua cuộc đua cùng `idempotencyKey`: unique index đã chờ bên thắng commit, nên đọc lại là thấy.
      const winner = await publications.findByIdempotencyKey(input.appId, idempotencyKey);
      if (!winner) throw new PublicationKeyTakenError(idempotencyKey);
      return { publication: await describePublication(this.deps, winner), created: false };
    }
    return { publication: await describePublication(this.deps, publication), created: true };
  }
}
