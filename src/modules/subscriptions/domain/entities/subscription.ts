import {
  BaseEntity,
  ValidationError,
  type AppId,
  type Channel,
  type SubscriptionId,
  type SubscriptionStatus,
  type SuppressedReason,
  type TimestampInput,
  type UserId,
} from '../../../../shared/kernel/index.ts';
import { channelGate, type GateResult, type SubscriptionGateState } from '../rules/subscription-gate.ts';

export interface SubscriptionProps extends TimestampInput {
  id: SubscriptionId;
  userId: UserId;
  appId: AppId;
  channel: Channel;
  /** email / số điện thoại / push token. */
  value: string;
  status?: SubscriptionStatus | undefined;
  optedOutOptional?: boolean | undefined;
  optedOutOptionalAt?: Date | null | undefined;
  suppressedReason?: SuppressedReason | null | undefined;
  suppressedAt?: Date | null | undefined;
  manageToken: string;
  manageTokenRotatedAt?: Date | undefined;
}

/**
 * Subscription = một điểm nhận của user trên một kênh, TRONG MỘT APP.
 * `UNIQUE (app_id, channel, value)`.
 *
 * Scope theo app là có chủ đích: tắt tin ở Shop Service không được lan sang Seller Service.
 * Muốn tắt hết mọi app thì đó là một hành động riêng, do user bấm, đi qua person_id.
 */
export class Subscription extends BaseEntity<SubscriptionId> {
  readonly userId: UserId;
  readonly appId: AppId;
  readonly channel: Channel;
  value: string;
  status: SubscriptionStatus;
  /** "Tắt hết những gì không bắt buộc" — tách hẳn khỏi `status`. */
  optedOutOptional: boolean;
  optedOutOptionalAt: Date | null;
  suppressedReason: SuppressedReason | null;
  suppressedAt: Date | null;
  /** Token nhúng trong link "Quản lý thông báo" ở footer — không lộ user_id/person_id. */
  manageToken: string;
  manageTokenRotatedAt: Date;

  constructor(props: SubscriptionProps) {
    super(props.id, props);
    if (!props.value.trim()) throw ValidationError.of('SUBSCRIPTION_VALUE_REQUIRED', 'subscription value must not be empty', 'value');
    this.userId = props.userId;
    this.appId = props.appId;
    this.channel = props.channel;
    this.value = props.value.trim();
    this.status = props.status ?? 'active';
    this.optedOutOptional = props.optedOutOptional ?? false;
    this.optedOutOptionalAt = props.optedOutOptionalAt ?? null;
    this.suppressedReason = props.suppressedReason ?? null;
    this.suppressedAt = props.suppressedAt ?? null;
    this.manageToken = props.manageToken;
    this.manageTokenRotatedAt = props.manageTokenRotatedAt ?? this.createdAt;
  }

  get gateState(): SubscriptionGateState {
    return {
      status: this.status,
      suppressedReason: this.suppressedReason,
      optedOutOptional: this.optedOutOptional,
    };
  }

  canReceive(opts: { topicMandatory: boolean }): GateResult {
    return channelGate(this.gateState, opts);
  }

  /**
   * User chủ động ngắt hẳn kênh. Khác với tắt tin không bắt buộc.
   * Chỉ tác động lên kênh đang `active`: gọi lại là no-op, và địa chỉ `invalid` giữ nguyên `invalid` —
   * hard bounce không bao giờ bị "hạ" thành `unsubscribed` (BR-9). Trả true nếu trạng thái thật sự đổi.
   */
  unsubscribe(at: Date): boolean {
    if (this.status !== 'active') return false;
    this.status = 'unsubscribed';
    this.suppressedReason = 'user_unsubscribe';
    this.suppressedAt = at;
    this.touch(at);
    return true;
  }

  /**
   * Hard bounce / spam complaint -> `invalid`, KHÔNG BAO GIỜ `unsubscribed` (BR-9).
   * Hai thứ này khác nhau về cả nguyên nhân lẫn quyền bật lại.
   */
  markInvalid(reason: Extract<SuppressedReason, 'hard_bounce' | 'complaint'>, at: Date): void {
    this.status = 'invalid';
    this.suppressedReason = reason;
    this.suppressedAt = at;
    this.touch(at);
  }

  /**
   * Bật lại kênh. App service KHÔNG được tự bật lại địa chỉ đã hard bounce / bị complaint
   * — làm vậy là lặp lại đúng vấn đề domain reputation dùng chung.
   */
  resubscribe(evidence: string, at: Date): void {
    if (!evidence.trim()) {
      throw ValidationError.of(
        'RESUBSCRIBE_EVIDENCE_REQUIRED',
        'resubscribe requires evidence for the audit trail',
        'evidence',
      );
    }
    if (this.suppressedReason === 'hard_bounce' || this.suppressedReason === 'complaint') {
      throw ValidationError.of(
        'RESUBSCRIBE_BLOCKED',
        `cannot resubscribe: address is suppressed due to ${this.suppressedReason}, fix the address instead`,
      );
    }
    this.status = 'active';
    this.suppressedReason = null;
    this.suppressedAt = null;
    this.touch(at);
  }

  /** Sửa địa chỉ sai (khác hẳn resubscribe) — địa chỉ mới thì reputation cũ không còn áp. */
  fixAddress(newValue: string, newManageToken: string, at: Date): void {
    const value = newValue.trim();
    if (!value) throw ValidationError.of('ADDRESS_REQUIRED', 'new address must not be empty', 'value');
    this.value = value;
    this.status = 'active';
    this.suppressedReason = null;
    this.suppressedAt = null;
    // Địa chỉ đổi -> link quản lý cũ phải chết theo.
    this.rotateManageToken(newManageToken, at);
  }

  /**
   * App service đổi địa chỉ của user (MVP — ADR-0016). Khác `fixAddress` ở MỘT điểm quan trọng:
   *   - `invalid` (địa chỉ cũ hỏng) -> xoá: địa chỉ mới chưa hề bounce.
   *   - `unsubscribed` (USER tự ngắt) -> GIỮ: đó là ý muốn của người, không phải lỗi của địa chỉ.
   *     Đổi địa chỉ mà bật lại nhận thư là gửi cho người đã từ chối.
   * Link quản lý cũ luôn chết theo địa chỉ cũ.
   */
  changeAddress(newValue: string, newManageToken: string, at: Date): void {
    const value = newValue.trim();
    if (!value) throw ValidationError.of('ADDRESS_REQUIRED', 'new address must not be empty', 'value');
    this.value = value;
    if (this.status === 'invalid') {
      this.status = 'active';
      this.suppressedReason = null;
      this.suppressedAt = null;
    }
    this.rotateManageToken(newManageToken, at);
  }

  optOutOptional(at: Date): void {
    this.optedOutOptional = true;
    this.optedOutOptionalAt = at;
    this.touch(at);
  }

  optInOptional(at: Date): void {
    this.optedOutOptional = false;
    this.optedOutOptionalAt = null;
    this.touch(at);
  }

  /** Xoay token mỗi khi user đổi preference, để link cũ trong email đã gửi không dùng lại được. */
  rotateManageToken(newToken: string, at: Date): void {
    this.manageToken = newToken;
    this.manageTokenRotatedAt = at;
    this.touch(at);
  }
}
