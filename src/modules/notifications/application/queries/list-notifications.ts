import type { AppId, NotificationStatus, TopicId, UserId } from '../../../../shared/kernel/index.ts';
import { toNotificationSummaryDto, type NotificationPageDto } from '../dto.ts';
import type { NotificationRepository, RecipientLookup, RecipientRepository, TopicConsentLookup } from '../ports/index.ts';

/** Giới hạn cứng: bề mặt đọc không được biến thành đường kéo cả lịch sử gửi về một lần. */
export const MAX_NOTIFICATION_PAGE = 200;

/**
 * Lịch sử gửi của MỘT app, cho màn quản trị (plan §5 — bề mặt đọc cho vận hành). Trả lời câu
 * "thư gửi anh A lúc 9 giờ ra sao" mà không phải vào máy chủ đọc log.
 *
 * Mọi thứ đi kèm lấy theo LÔ — cả trang tốn cố định 4 truy vấn (topic của app, trang notification,
 * người nhận, external_id), không phụ thuộc số dòng.
 *
 * Lọc theo `topic` / `externalId` là khớp ĐÚNG. Giá trị không tồn tại -> trang rỗng, không 404:
 * đây là bộ lọc, "không có thư nào khớp" là một câu trả lời hợp lệ.
 */
export class ListNotifications {
  private readonly deps: {
    notifications: NotificationRepository;
    recipients: RecipientRepository;
    users: RecipientLookup;
    topics: TopicConsentLookup;
  };

  constructor(deps: ListNotifications['deps']) {
    this.deps = deps;
  }

  async execute(input: {
    appId: AppId;
    limit: number;
    offset: number;
    status?: NotificationStatus | undefined;
    topic?: string | undefined;
    externalId?: string | undefined;
  }): Promise<NotificationPageDto> {
    const limit = Math.min(input.limit, MAX_NOTIFICATION_PAGE);
    const empty: NotificationPageDto = { rows: [], total: 0, limit, offset: input.offset };
    const topics = await this.deps.topics.topicsByApp(input.appId);

    let topicId: TopicId | undefined;
    if (input.topic !== undefined) {
      topicId = topics.find((topic) => topic.key === input.topic)?.topicId;
      if (!topicId) return empty;
    }
    let targetUserId: UserId | undefined;
    if (input.externalId !== undefined) {
      targetUserId = (await this.deps.users.findUserId(input.appId, input.externalId)) ?? undefined;
      if (!targetUserId) return empty;
    }

    const page = await this.deps.notifications.listByApp(
      input.appId,
      { status: input.status, topicId, targetUserId },
      { limit, offset: input.offset },
    );
    const userIds = [...new Set(page.rows.flatMap((n) => (n.targetUserId === null ? [] : [n.targetUserId])))];
    const [recipients, externalIds] = await Promise.all([
      this.deps.recipients.findByNotifications(page.rows.map((n) => n.id)),
      this.deps.users.externalIds(input.appId, userIds),
    ]);
    const topicKeys = new Map(topics.map((topic) => [topic.topicId, topic.key] as const));

    return {
      rows: page.rows.map((n) =>
        toNotificationSummaryDto(n, {
          topicKey: topicKeys.get(n.topicId) ?? '',
          externalId: n.targetUserId === null ? null : (externalIds.get(n.targetUserId) ?? null),
          recipient: recipients.get(n.id) ?? null,
        }),
      ),
      total: page.total,
      limit,
      offset: input.offset,
    };
  }
}
