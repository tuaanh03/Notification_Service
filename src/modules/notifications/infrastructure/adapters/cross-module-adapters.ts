import type { AppQueries } from '../../../apps/application/index.ts';
import type { SendEmail, SendRateLimiter } from '../../../delivery/application/index.ts';
import type { SystemSettingsQueries } from '../../../settings/application/index.ts';
import type { FindUserByExternalId } from '../../../directory/application/index.ts';
import type { EmailSubscriptionDto, FindUserEmail } from '../../../subscriptions/application/index.ts';
import type { ConsentQueries } from '../../../topics/application/index.ts';
import {
  CHANNELS,
  SUBSCRIPTION_STATUSES,
  SUPPRESSED_REASONS,
  SubscriptionId,
  parseSendWindow,
  UserId,
  type AppId,
  type Channel,
  type SubscriptionStatus,
  type TopicId,
  type UserId as UserIdType,
} from '../../../../shared/kernel/index.ts';
import type {
  AppSendingLookup,
  EmailCounts,
  EmailDeliveryOutcome,
  EmailLookup,
  EmailSender,
  OpenTrackingConfig,
  RecipientLookup,
  SendPolicy,
  SendPolicyLookup,
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

  externalIds(appId: AppId, userIds: readonly UserIdType[]): Promise<Map<UserIdType, string>> {
    return this.findUser.externalIdsOf({ appId, userIds });
  }

  countUsers(appId: AppId): Promise<number> {
    return this.findUser.countOf({ appId });
  }

  deletedUserIds(appId: AppId): Promise<UserIdType[]> {
    return this.findUser.deletedIdsOf({ appId });
  }
}

/**
 * notifications -> subscriptions. DTO của subscriptions mang status dạng chuỗi — đổi lại thành kiểu
 * của kernel và TỪ CHỐI giá trị lạ: gate chạy trên dữ liệu sai là gửi nhầm.
 */
export class SubscriptionsEmailLookup implements EmailLookup, EmailCounts {
  private readonly findUserEmail: FindUserEmail;

  constructor(deps: { findUserEmail: FindUserEmail }) {
    this.findUserEmail = deps.findUserEmail;
  }

  async find(appId: AppId, userId: UserIdType): Promise<UserEmailForDelivery | null> {
    const dto = await this.findUserEmail.execute({ appId, userId });
    return dto ? toDelivery(dto) : null;
  }

  async listByApp(appId: AppId): Promise<Map<UserIdType, UserEmailForDelivery>> {
    const found = await this.findUserEmail.listOf({ appId });
    return new Map([...found].map(([userId, dto]) => [userId, toDelivery(dto)]));
  }

  countByStatus(appId: AppId, excludeUserIds: readonly UserIdType[]): Promise<Record<SubscriptionStatus, number>> {
    return this.findUserEmail.countByStatus({ appId, excludeUserIds });
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

  topicsByApp(appId: AppId): Promise<TopicForDelivery[]> {
    return this.consent.topicsByApp(appId);
  }

  preference(userId: UserIdType, topicId: TopicId): Promise<{ optedIn: boolean } | null> {
    return this.consent.preference(userId, topicId);
  }

  preferences(topicId: TopicId, userIds: readonly UserIdType[]): Promise<Map<UserIdType, { optedIn: boolean }>> {
    return this.consent.preferencesOf(topicId, userIds);
  }
}

/** notifications -> delivery. `SendEmail` đã tự thử lại, kết quả không còn `retryable`. */
export class DeliveryEmailSender implements EmailSender {
  private readonly sendEmail: SendEmail;
  private readonly rateLimiter: SendRateLimiter;

  constructor(deps: { sendEmail: SendEmail; sendRateLimiter: SendRateLimiter }) {
    this.sendEmail = deps.sendEmail;
    this.rateLimiter = deps.sendRateLimiter;
  }

  awaitCapacity(): Promise<void> {
    return this.rateLimiter.acquire();
  }

  send(email: { to: string; subject: string; html: string; text: string | null; notificationId: string }): Promise<EmailDeliveryOutcome> {
    return this.sendEmail.execute(email);
  }
}

/** notifications -> apps + settings: cờ đếm "đã mở" của app + domain API công khai (ADR-0031). */
export class AppsOpenTrackingConfig implements OpenTrackingConfig {
  private readonly appQueries: AppQueries;
  private readonly systemSettings: SystemSettingsQueries;

  constructor(deps: { appQueries: AppQueries; systemSettings: SystemSettingsQueries }) {
    this.appQueries = deps.appQueries;
    this.systemSettings = deps.systemSettings;
  }

  async forApp(appId: AppId): Promise<{ enabled: boolean; publicBaseUrl: string | null }> {
    const [app, settings] = await Promise.all([this.appQueries.get(appId), this.systemSettings.current()]);
    return { enabled: app.trackOpens, publicBaseUrl: settings['api.public_base_url'] };
  }
}

/** notifications -> apps: trạng thái + kênh cấp của app cho đường gửi từ console. */
export class AppsSendingLookup implements AppSendingLookup {
  private readonly appQueries: AppQueries;

  constructor(deps: { appQueries: AppQueries }) {
    this.appQueries = deps.appQueries;
  }

  async sendingOf(appId: AppId): Promise<{ active: boolean; grantedChannels: readonly Channel[] }> {
    const app = await this.appQueries.get(appId);
    const known = new Set<string>(CHANNELS);
    return { active: app.status === 'active', grantedChannels: app.grantedChannels.filter((c): c is Channel => known.has(c)) };
  }
}

/** notifications -> apps: khung giờ gửi + dàn đều (ADR-0032). */
export class AppsSendPolicyLookup implements SendPolicyLookup {
  private readonly appQueries: AppQueries;

  constructor(deps: { appQueries: AppQueries }) {
    this.appQueries = deps.appQueries;
  }

  async forApp(appId: AppId): Promise<SendPolicy> {
    const app = await this.appQueries.get(appId);
    return {
      window: app.sendWindow === null ? null : parseSendWindow(app.sendWindow),
      mandatoryBypassWindow: app.mandatoryBypassWindow,
      perMinute: app.sendPerMinute,
      mandatoryBypassPacing: app.mandatoryBypassPacing,
      maxPerMinute: app.maxSendPerMinute,
    };
  }
}

function toDelivery(dto: EmailSubscriptionDto): UserEmailForDelivery {
  return {
    subscriptionId: SubscriptionId.parse(dto.subscriptionId),
    address: dto.address,
    status: oneOf(SUBSCRIPTION_STATUSES, dto.status, 'subscription status'),
    suppressedReason: dto.suppressedReason === null ? null : oneOf(SUPPRESSED_REASONS, dto.suppressedReason, 'suppressed reason'),
    optedOutOptional: dto.optedOutOptional,
  };
}

function oneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`unexpected ${what}: ${value}`);
  return value as T;
}
