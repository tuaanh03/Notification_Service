import {
  BaseEntity,
  ValidationError,
  issue,
  type Issue,
  type AccountId,
  type AppId,
  type AppOrigin,
  type AppStatus,
  type Channel,
  type OrgId,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';
import { nextAppStatus, type AppTransitionEvent } from '../rules/app-transitions.ts';

export interface AppProps extends TimestampInput {
  id: AppId;
  orgId: OrgId;
  /** Account sở hữu org của app. Denormalize để DB ép được RBAC cùng account (ADR-0011). */
  accountId: AccountId;
  slug: string;
  name: string;
  namespace: string;
  status?: AppStatus | undefined;
  origin?: AppOrigin | undefined;
  grantedChannels?: readonly Channel[] | undefined;
  rateLimitPerMinute?: number | undefined;
  maxRecipientsPerEvent?: number | undefined;
  /** Org admin chủ động chọn app nào tham gia broadcast toàn org. */
  includedInOrgBroadcast?: boolean | undefined;
  /** App SYS: chạm được mọi user trong org, chỉ Super Admin thấy và setup. */
  isSystem?: boolean | undefined;
}

/** Quyền cấp cho app lúc duyệt. */
export interface AppGrant {
  grantedChannels: readonly Channel[];
  rateLimitPerMinute: number;
  maxRecipientsPerEvent: number;
}

/**
 * App là ranh giới CÔ LẬP MESSAGING: hai app không chia sẻ segment/template/notification.
 * `external_id` chỉ unique trong phạm vi một app, không toàn cục.
 */
export class App extends BaseEntity<AppId> {
  readonly orgId: OrgId;
  readonly accountId: AccountId;
  readonly slug: string;
  readonly namespace: string;
  readonly isSystem: boolean;
  name: string;
  status: AppStatus;
  origin: AppOrigin;
  grantedChannels: readonly Channel[];
  rateLimitPerMinute: number;
  maxRecipientsPerEvent: number;
  includedInOrgBroadcast: boolean;

  constructor(props: AppProps) {
    super(props.id, props);
    const issues: Issue[] = [];
    const slug = props.slug.trim();
    const namespace = props.namespace.trim();
    const name = props.name.trim();
    if (!slug) issues.push(issue('APP_SLUG_REQUIRED', 'app slug must not be empty', 'slug'));
    if (!namespace) issues.push(issue('APP_NAMESPACE_REQUIRED', 'app namespace must not be empty', 'namespace'));
    if (!name) issues.push(issue('APP_NAME_REQUIRED', 'app name must not be empty', 'name'));
    if (issues.length) throw new ValidationError(issues);

    this.orgId = props.orgId;
    this.accountId = props.accountId;
    this.slug = slug;
    this.namespace = namespace;
    this.name = name;
    this.status = props.status ?? 'draft';
    this.origin = props.origin ?? 'internal';
    this.grantedChannels = props.grantedChannels ?? [];
    this.rateLimitPerMinute = props.rateLimitPerMinute ?? 60;
    this.maxRecipientsPerEvent = props.maxRecipientsPerEvent ?? 1000;
    this.includedInOrgBroadcast = props.includedInOrgBroadcast ?? true;
    this.isSystem = props.isSystem ?? false;
  }

  /**
   * Duyệt app kèm QUYỀN ĐƯỢC CẤP (UC-001): kênh được gửi, hạn mức. App chỉ gửi được trên kênh đã
   * cấp — duyệt mà không cấp kênh nào là tạo ra app không làm được gì, nên chặn ở đây.
   */
  approve(grant: AppGrant, at: Date): void {
    const issues: Issue[] = [];
    const channels = [...new Set(grant.grantedChannels)];
    if (channels.length === 0) {
      issues.push(issue('GRANT_CHANNELS_REQUIRED', 'at least one channel must be granted', 'grantedChannels'));
    }
    if (!Number.isInteger(grant.rateLimitPerMinute) || grant.rateLimitPerMinute <= 0) {
      issues.push(issue('GRANT_RATE_LIMIT_INVALID', 'rateLimitPerMinute must be a positive integer', 'rateLimitPerMinute'));
    }
    if (!Number.isInteger(grant.maxRecipientsPerEvent) || grant.maxRecipientsPerEvent <= 0) {
      issues.push(
        issue('GRANT_MAX_RECIPIENTS_INVALID', 'maxRecipientsPerEvent must be a positive integer', 'maxRecipientsPerEvent'),
      );
    }
    if (issues.length) throw new ValidationError(issues);

    this.apply('approve', at);
    this.grantedChannels = channels;
    this.rateLimitPerMinute = grant.rateLimitPerMinute;
    this.maxRecipientsPerEvent = grant.maxRecipientsPerEvent;
  }

  /** Mọi đổi trạng thái đi qua đây — không ai set `status` trực tiếp. */
  apply(event: AppTransitionEvent, at: Date): AppStatus {
    const from = this.status;
    this.status = nextAppStatus(from, event);
    this.touch(at);
    return this.status;
  }

  /** App đã thu hồi là trạng thái kết thúc: không cấp thêm credential nào nữa. */
  assertAcceptsNewSecret(): void {
    if (this.status === 'revoked') {
      throw ValidationError.of('APP_REVOKED', `app ${this.slug} is revoked and cannot receive new secrets`);
    }
  }

  get canSend(): boolean {
    return this.status === 'active';
  }

  grantsChannel(channel: Channel): boolean {
    return this.grantedChannels.includes(channel);
  }

  assertCanSendOn(channel: Channel): void {
    if (!this.canSend) {
      throw ValidationError.of(
        'APP_NOT_ACTIVE',
        `app ${this.slug} is ${this.status} and cannot send`,
      );
    }
    if (!this.grantsChannel(channel)) {
      throw ValidationError.of(
        'CHANNEL_NOT_GRANTED',
        `app ${this.slug} is not granted channel ${channel}`,
        'channel',
      );
    }
  }
}
