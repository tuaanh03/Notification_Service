import {
  BaseEntity,
  ValidationError,
  type AppId,
  type AppOrigin,
  type AppStatus,
  type Channel,
  type OrgId,
  type TimestampInput,
} from '../../../shared/kernel/index.ts';
import { nextAppStatus, type AppTransitionEvent } from './app-transitions.ts';

export interface AppProps extends TimestampInput {
  id: AppId;
  orgId: OrgId;
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
    const issues: string[] = [];
    const slug = props.slug.trim();
    const namespace = props.namespace.trim();
    const name = props.name.trim();
    if (!slug) issues.push('app slug không được rỗng');
    if (!namespace) issues.push('app namespace không được rỗng');
    if (!name) issues.push('app name không được rỗng');
    if (issues.length) throw new ValidationError(issues);

    this.orgId = props.orgId;
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
      throw new ValidationError([`app ${this.slug} đang ở trạng thái ${this.status}, không gửi được`]);
    }
    if (!this.grantsChannel(channel)) {
      throw new ValidationError([`app ${this.slug} chưa được cấp kênh ${channel}`]);
    }
  }
}
