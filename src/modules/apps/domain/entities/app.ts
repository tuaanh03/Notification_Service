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
  type SendWindow,
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
  /** Chèn ảnh theo dõi vào thư để đếm "đã mở" (ADR-0031). Mặc định tắt. */
  trackOpens?: boolean | undefined;
  /** Khung giờ gửi (ADR-0032). null = gửi mọi lúc. */
  sendWindow?: SendWindow | null | undefined;
  /** Tin bắt buộc bỏ qua khung giờ. Mặc định true. */
  mandatoryBypassWindow?: boolean | undefined;
}

/**
 * Kênh cấp sẵn cho app tự phục vụ (ADR-0023). MVP chỉ gửi email — kênh là thứ DUY NHẤT trong
 * "quyền cấp" mà lúc gửi thật sự kiểm (`assertChannel`).
 */
export const SELF_SERVE_CHANNELS: readonly Channel[] = ['email'];

/** Quyền cấp cho app lúc duyệt — chỉ còn cho app cũ đang chờ duyệt (ADR-0023). */
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
  trackOpens: boolean;
  sendWindow: SendWindow | null;
  mandatoryBypassWindow: boolean;

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
    this.trackOpens = props.trackOpens ?? false;
    this.sendWindow = props.sendWindow ?? null;
    this.mandatoryBypassWindow = props.mandatoryBypassWindow ?? true;
  }

  /**
   * Đăng ký app tự phục vụ (ADR-0023): tạo xong là `active`, cấp sẵn `SELF_SERVE_CHANNELS` —
   * không qua duyệt. Đội app tự cấp khoá API; app rác do Super Admin tạm ngưng / thu hồi.
   */
  static register(props: Omit<AppProps, 'status' | 'grantedChannels'>): App {
    return new App({ ...props, status: 'active', grantedChannels: SELF_SERVE_CHANNELS });
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

  /** Bật / tắt đếm "đã mở" (ADR-0031). Trả false nếu giá trị không đổi — không ghi, không audit. */
  setOpenTracking(enabled: boolean, at: Date): boolean {
    if (this.trackOpens === enabled) return false;
    this.trackOpens = enabled;
    this.touch(at);
    return true;
  }

  /**
   * Đặt khung giờ gửi (ADR-0032) — `window` đã qua `parseSendWindow`. Trả false nếu không đổi gì.
   * Chỉ áp cho thư nhận SAU lúc đổi: thư đang chờ giữ nguyên giờ đã hẹn.
   */
  setSendWindow(window: SendWindow | null, mandatoryBypass: boolean, at: Date): boolean {
    if (sameWindow(this.sendWindow, window) && this.mandatoryBypassWindow === mandatoryBypass) return false;
    this.sendWindow = window;
    this.mandatoryBypassWindow = mandatoryBypass;
    this.touch(at);
    return true;
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

function sameWindow(a: SendWindow | null, b: SendWindow | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end && a.days.join() === b.days.join();
}
