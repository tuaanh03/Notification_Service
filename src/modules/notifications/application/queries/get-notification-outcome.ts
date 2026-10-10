import type { NotificationId } from '../../../../shared/kernel/index.ts';
import type { NotificationRepository, RecipientLookup, RecipientRepository, TopicConsentLookup } from '../ports/index.ts';

/**
 * Kết quả một lần gửi, đủ để báo cho app (outgoing webhook — ADR-0029). KHÔNG có địa chỉ email và nội
 * dung thư — cùng lý do với `NotificationDto`.
 */
export interface NotificationOutcomeDto {
  notificationId: string;
  appId: string;
  publicationId: string | null;
  /** null = user đã không còn trong sổ người nhận. */
  externalId: string | null;
  topic: string;
  status: string;
  exclusionReason: string | null;
  error: string | null;
}

/** Query công khai cho module khác (webhooks). null = không có notification này. */
export class GetNotificationOutcome {
  private readonly deps: {
    notifications: NotificationRepository;
    recipients: RecipientRepository;
    users: RecipientLookup;
    topics: TopicConsentLookup;
  };

  constructor(deps: GetNotificationOutcome['deps']) {
    this.deps = deps;
  }

  async execute(id: NotificationId): Promise<NotificationOutcomeDto | null> {
    const n = await this.deps.notifications.findById(id);
    if (!n) return null;
    const [recipient, topic, externalIds] = await Promise.all([
      this.deps.recipients.findByNotification(n.id),
      this.deps.topics.topicById(n.topicId),
      n.targetUserId === null ? new Map<string, string>() : this.deps.users.externalIds(n.appId, [n.targetUserId]),
    ]);
    return {
      notificationId: n.id,
      appId: n.appId,
      publicationId: n.publicationId,
      externalId: n.targetUserId === null ? null : (externalIds.get(n.targetUserId) ?? null),
      topic: topic?.key ?? '',
      status: n.status,
      exclusionReason: recipient?.exclusionReason ?? null,
      error: recipient?.error ?? null,
    };
  }
}
