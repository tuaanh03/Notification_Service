import type {
  Channel,
  ExclusionReason,
  NotificationId,
  PersonId,
  RecipientStatus,
  SegmentId,
  SubscriptionId,
  UserId,
} from '../../../../shared/kernel/index.ts';

/**
 * Snapshot từng người nhận, chốt tại lối vào `queued` — nguồn trả lời
 * "tại sao thông báo đó không tới" nhiều tháng sau.
 * PK (notification_id, user_id, channel).
 */
export class NotificationRecipient {
  readonly notificationId: NotificationId;
  readonly userId: UserId;
  readonly personId: PersonId | null;
  readonly subscriptionId: SubscriptionId | null;
  readonly channel: Channel;
  readonly address: string;
  readonly includedVia: SegmentId | 'all_users' | null;
  readonly exclusionReason: ExclusionReason | null;
  batchNo: number | null;
  status: RecipientStatus;
  providerMessageId: string | null;
  error: string | null;
  sentAt: Date | null;

  constructor(props: {
    notificationId: NotificationId;
    userId: UserId;
    personId?: PersonId | null | undefined;
    subscriptionId?: SubscriptionId | null | undefined;
    channel: Channel;
    address: string;
    includedVia?: SegmentId | 'all_users' | null | undefined;
    exclusionReason?: ExclusionReason | null | undefined;
    batchNo?: number | null | undefined;
    status?: RecipientStatus | undefined;
    providerMessageId?: string | null | undefined;
    error?: string | null | undefined;
    sentAt?: Date | null | undefined;
  }) {
    this.notificationId = props.notificationId;
    this.userId = props.userId;
    this.personId = props.personId ?? null;
    this.subscriptionId = props.subscriptionId ?? null;
    this.channel = props.channel;
    this.address = props.address;
    this.includedVia = props.includedVia ?? null;
    this.exclusionReason = props.exclusionReason ?? null;
    this.batchNo = props.batchNo ?? null;
    this.status = props.status ?? 'pending';
    this.providerMessageId = props.providerMessageId ?? null;
    this.error = props.error ?? null;
    this.sentAt = props.sentAt ?? null;
  }

  markSent(providerMessageId: string, at: Date): void {
    this.status = 'sent';
    this.providerMessageId = providerMessageId;
    this.sentAt = at;
  }

  markBounced(error: string): void {
    this.status = 'bounced';
    this.error = error;
  }

  markFailed(error: string): void {
    this.status = 'failed';
    this.error = error;
  }

  /** Lô bị bỏ vì người dùng bấm Dừng — con số này là "đã dừng bao nhiêu". */
  markSkipped(): void {
    this.status = 'skipped';
  }
}
