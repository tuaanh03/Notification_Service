import {
  ValidationError,
  type Channel,
  type DeliveryBatchId,
  type DeliveryBatchStatus,
  type NotificationId,
} from '../../../../shared/kernel/index.ts';

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
    if (props.size <= 0) throw ValidationError.of('BATCH_SIZE_INVALID', 'batch size must be greater than 0', 'size');
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
