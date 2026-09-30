import type {
  AppId,
  SubscriptionId,
  SubscriptionStatus,
  SuppressedReason,
  TemplateId,
  TemplateVersionId,
  TopicId,
  UserId,
} from '../../../../shared/kernel/index.ts';

/**
 * Cổng sang module khác — adapter gọi query / use case công khai của module đó (không đọc bảng của nó).
 * Kiểu dữ liệu khai bằng kiểu của kernel, KHÔNG import domain của module kia.
 */

/** -> directory: người nhận theo external_id trong app. */
export interface RecipientLookup {
  findUserId(appId: AppId, externalId: string): Promise<UserId | null>;
  /** `external_id` theo LÔ cho màn danh sách. User không còn thì vắng mặt trong Map. */
  externalIds(appId: AppId, userIds: readonly UserId[]): Promise<Map<UserId, string>>;
  /** Tổng số người nhận của app — màn Tổng quan. */
  countUsers(appId: AppId): Promise<number>;
}

/** -> subscriptions: email của user, đủ để chạy L0/L1 và để gửi. */
export interface UserEmailForDelivery {
  subscriptionId: SubscriptionId;
  address: string;
  status: SubscriptionStatus;
  suppressedReason: SuppressedReason | null;
  optedOutOptional: boolean;
}

export interface EmailLookup {
  find(appId: AppId, userId: UserId): Promise<UserEmailForDelivery | null>;
}

/** -> subscriptions: số email của app theo trạng thái — màn Tổng quan. Tách khỏi `EmailLookup` của đường gửi. */
export interface EmailCounts {
  countByStatus(appId: AppId): Promise<Record<SubscriptionStatus, number>>;
}

/** -> topics: topic + preference, đủ để chạy L3. */
export interface TopicForDelivery {
  topicId: TopicId;
  key: string;
  status: string;
  mandatory: boolean;
  defaultOptedIn: boolean;
}

export interface TopicConsentLookup {
  topicByKey(appId: AppId, key: string): Promise<TopicForDelivery | null>;
  topicById(topicId: TopicId): Promise<TopicForDelivery | null>;
  /** Mọi topic của app — màn danh sách đổi `topic_id` ra `key` bằng MỘT truy vấn. */
  topicsByApp(appId: AppId): Promise<TopicForDelivery[]>;
  preference(userId: UserId, topicId: TopicId): Promise<{ optedIn: boolean } | null>;
}

/** -> delivery: gửi một email. Kết quả đã hết `retryable` (delivery tự thử lại). */
export type EmailDeliveryOutcome =
  | { kind: 'accepted'; providerMessageId: string | null }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unknown'; reason: string };

export interface EmailSender {
  /**
   * Chờ lượt gửi (giới hạn tốc độ của mailbox gửi). Gọi SAU gate, TRƯỚC khi nhận việc: thư bị chặn
   * không tốn lượt, và lúc đang chờ notification vẫn `queued` — worker chết thì không có outcome_unknown oan.
   */
  awaitCapacity(): Promise<void>;
  send(email: { to: string; subject: string; html: string; text: string | null; notificationId: string }): Promise<EmailDeliveryOutcome>;
}

/** -> templates: nội dung đã đổ biến từ bản đang xuất bản (ADR-0020). Lỗi là ValidationError 422. */
export interface RenderedEmailTemplate {
  templateId: TemplateId;
  templateVersionId: TemplateVersionId;
  name: string;
  version: number;
  subject: string;
  html: string;
  text: string;
}

export interface TemplateRenderer {
  render(input: {
    appId: AppId;
    templateId: TemplateId;
    payload: Readonly<Record<string, unknown>>;
    externalId: string;
  }): Promise<RenderedEmailTemplate>;
}

/** -> templates: lần gửi chỉ lưu `template_version_id`; tên + số version tra theo LÔ khi hiển thị. */
export interface TemplateLabel {
  templateId: TemplateId;
  name: string;
  version: number;
}

export interface TemplateLabels {
  labelsOf(versionIds: readonly TemplateVersionId[]): Promise<Map<TemplateVersionId, TemplateLabel>>;
}
