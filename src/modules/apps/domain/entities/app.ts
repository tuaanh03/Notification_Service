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

  /** Mọi đổi trạng thái đi qua đây — không ai set `status` trực tiếp. */
  apply(event: AppTransitionEvent): AppStatus {
    const from = this.status;
    this.status = nextAppStatus(from, event);
    this.touch();
    return this.status;
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
