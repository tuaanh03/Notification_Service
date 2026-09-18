import type { SendEmail } from '../../../delivery/application/index.ts';
import type { FindUserByExternalId } from '../../../directory/application/index.ts';
import type { FindUserEmail } from '../../../subscriptions/application/index.ts';
import type { ConsentQueries } from '../../../topics/application/index.ts';
import {
  SUBSCRIPTION_STATUSES,
  SUPPRESSED_REASONS,
  SubscriptionId,
  UserId,
  type AppId,
  type TopicId,
  type UserId as UserIdType,
} from '../../../../shared/kernel/index.ts';
import type {
  EmailDeliveryOutcome,
  EmailLookup,
  EmailSender,
  RecipientLookup,
  TopicConsentLookup,
  TopicForDelivery,
  UserEmailForDelivery,
} from '../../application/ports/index.ts';

/** notifications -> directory. */
export class DirectoryRecipientLookup implements RecipientLookup {
  private readonly findUser: FindUserByExternalId;

  constructor(deps: { findUser: FindUserByExternalId }) {
    this.findUser = deps.findUser;
  }

  async findUserId(appId: AppId, externalId: string): Promise<UserIdType | null> {
    const user = await this.findUser.find({ appId, externalId });
    return user ? UserId.parse(user.userId) : null;
  }
}

/**
 * notifications -> subscriptions. DTO của subscriptions mang status dạng chuỗi — đổi lại thành kiểu
 * của kernel và TỪ CHỐI giá trị lạ: gate chạy trên dữ liệu sai là gửi nhầm.
 */
export class SubscriptionsEmailLookup implements EmailLookup {
  private readonly findUserEmail: FindUserEmail;

  constructor(deps: { findUserEmail: FindUserEmail }) {
    this.findUserEmail = deps.findUserEmail;
  }

  async find(appId: AppId, userId: UserIdType): Promise<UserEmailForDelivery | null> {
    const dto = await this.findUserEmail.execute({ appId, userId });
    if (!dto) return null;
    return {
      subscriptionId: SubscriptionId.parse(dto.subscriptionId),
      address: dto.address,
      status: oneOf(SUBSCRIPTION_STATUSES, dto.status, 'subscription status'),
      suppressedReason: dto.suppressedReason === null ? null : oneOf(SUPPRESSED_REASONS, dto.suppressedReason, 'suppressed reason'),
      optedOutOptional: dto.optedOutOptional,
    };
  }
}

/** notifications -> topics. */
export class TopicsConsentLookup implements TopicConsentLookup {
  private readonly consent: ConsentQueries;

  constructor(deps: { consentQueries: ConsentQueries }) {
    this.consent = deps.consentQueries;
  }

  topicByKey(appId: AppId, key: string): Promise<TopicForDelivery | null> {
    return this.consent.topicByKey(appId, key);
  }

  topicById(topicId: TopicId): Promise<TopicForDelivery | null> {
    return this.consent.topicById(topicId);
  }

  preference(userId: UserIdType, topicId: TopicId): Promise<{ optedIn: boolean } | null> {
    return this.consent.preference(userId, topicId);
  }
}

/** notifications -> delivery. `SendEmail` đã tự thử lại, kết quả không còn `retryable`. */
export class DeliveryEmailSender implements EmailSender {
  private readonly sendEmail: SendEmail;

  constructor(deps: { sendEmail: SendEmail }) {
    this.sendEmail = deps.sendEmail;
  }

  send(email: { to: string; subject: string; html: string; text: string | null; notificationId: string }): Promise<EmailDeliveryOutcome> {
    return this.sendEmail.execute(email);
  }
}

function oneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`unexpected ${what}: ${value}`);
  return value as T;
}
