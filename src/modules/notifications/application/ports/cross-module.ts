import type {
  AppId,
  SubscriptionId,
  SubscriptionStatus,
  SuppressedReason,
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
