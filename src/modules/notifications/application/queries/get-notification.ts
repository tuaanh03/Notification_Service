import { NotFoundError, type AppId, type NotificationId } from '../../../../shared/kernel/index.ts';
import { toNotificationDto, type NotificationDto } from '../dto.ts';
import type { NotificationRepository, RecipientRepository, TopicConsentLookup } from '../ports/index.ts';

/** `GET /v1/notifications/:id`. Notification của app khác trả 404 — không để lộ id đó tồn tại. */
export class GetNotification {
  private readonly deps: { notifications: NotificationRepository; recipients: RecipientRepository; topics: TopicConsentLookup };

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
    });
  }
}
