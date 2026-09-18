import {
  ValidationError,
  type Channel,
  type DeliveryBatchId,
  type DeliveryBatchStatus,
  type NotificationId,
} from '../../../shared/kernel/index.ts';

/** Chia lô 50–200 người. UNIQUE (notification_id, batch_no) -> consumer idempotent. */
export const MIN_BATCH_SIZE = 50;
export const MAX_BATCH_SIZE = 200;

export class DeliveryBatch {
  readonly id: DeliveryBatchId;
  readonly notificationId: NotificationId;
  readonly batchNo: number;
  readonly channel: Channel;
  readonly size: number;
  status: DeliveryBatchStatus;
  attempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;

  constructor(props: {
    id: DeliveryBatchId;
    notificationId: NotificationId;
    batchNo: number;
    channel: Channel;
    size: number;
    status?: DeliveryBatchStatus | undefined;
    attempts?: number | undefined;
    startedAt?: Date | null | undefined;
    finishedAt?: Date | null | undefined;
  }) {
    if (props.size <= 0) throw new ValidationError(['batch size phải lớn hơn 0']);
    this.id = props.id;
    this.notificationId = props.notificationId;
    this.batchNo = props.batchNo;
    this.channel = props.channel;
    this.size = props.size;
    this.status = props.status ?? 'pending';
    this.attempts = props.attempts ?? 0;
    this.startedAt = props.startedAt ?? null;
    this.finishedAt = props.finishedAt ?? null;
  }

  /** Delivery consumer kiểm tra cờ halt TRƯỚC MỖI LÔ — không cố xoá message khỏi stream. */
  skipBecauseHalted(at: Date): void {
    this.status = 'skipped';
    this.finishedAt = at;
  }
}

/** Chia danh sách người nhận thành các lô có kích thước hợp lệ. */
export function planBatches(total: number, size = MAX_BATCH_SIZE): number {
  if (total <= 0) return 0;
  const bounded = Math.min(Math.max(size, MIN_BATCH_SIZE), MAX_BATCH_SIZE);
  return Math.ceil(total / bounded);
}
