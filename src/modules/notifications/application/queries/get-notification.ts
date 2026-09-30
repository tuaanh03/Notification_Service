import { NotFoundError, type AppId, type NotificationId, type TemplateVersionId } from '../../../../shared/kernel/index.ts';
import { toNotificationDto, type NotificationDto } from '../dto.ts';
import type { NotificationRepository, RecipientRepository, TemplateLabel, TemplateLabels, TopicConsentLookup } from '../ports/index.ts';

/** `GET /v1/notifications/:id`. Notification của app khác trả 404 — không để lộ id đó tồn tại. */
export class GetNotification {
  private readonly deps: {
    notifications: NotificationRepository;
    recipients: RecipientRepository;
    topics: TopicConsentLookup;
    templates: TemplateLabels;
  };

  constructor(deps: GetNotification['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; id: NotificationId }): Promise<NotificationDto> {
    const notification = await this.deps.notifications.findById(input.id);
    if (!notification || notification.appId !== input.appId) throw new NotFoundError('notification', input.id);
    const topic = await this.deps.topics.topicById(notification.topicId);
    return toNotificationDto(notification, {
      topicKey: topic?.key ?? '',
      recipient: await this.deps.recipients.findByNotification(notification.id),
      template: await templateLabelOf(this.deps.templates, notification.templateVersionId),
    });
  }
}

/** Nhãn template của MỘT lần gửi; null khi gửi bằng nội dung viết thẳng. */
export async function templateLabelOf(
  templates: TemplateLabels,
  versionId: TemplateVersionId | null,
): Promise<TemplateLabel | null> {
  if (versionId === null) return null;
  return (await templates.labelsOf([versionId])).get(versionId) ?? null;
}
