import {
  BaseEntity,
  type AppId,
  type TimestampInput,
  type WebhookDeliveryId,
  type WebhookDeliveryStatus,
  type WebhookEndpointId,
} from '../../../../shared/kernel/index.ts';
import { nextAttemptAt } from '../rules/retry-schedule.ts';

/** Lỗi lưu tối đa chừng này ký tự — đủ đọc, không phình bảng. */
const MAX_ERROR_LENGTH = 500;

export interface WebhookDeliveryProps extends TimestampInput {
  id: WebhookDeliveryId;
  endpointId: WebhookEndpointId;
  appId: AppId;
  /** Id sự kiện gửi cho app — cố định qua mọi lần gọi lại, app dùng để bỏ bản trùng. */
  eventId: string;
  eventType: string;
  /** Body CHÍNH XÁC sẽ gửi (đã chốt) — mọi lần gọi lại gửi y hệt, chữ ký ký trên đúng chuỗi này. */
  body: string;
  status?: WebhookDeliveryStatus | undefined;
  attempts?: number | undefined;
  nextAttemptAt?: Date | null | undefined;
  lastStatusCode?: number | null | undefined;
  lastError?: string | null | undefined;
  deliveredAt?: Date | null | undefined;
}

/**
 * MỘT lần EWS phải báo một sự kiện cho một URL (ADR-0029 §6). Gọi ít nhất một lần: lỗi thì hẹn lượt
 * sau theo `nextAttemptAt()`, hết lượt thì `failed`.
 */
export class WebhookDelivery extends BaseEntity<WebhookDeliveryId> {
  readonly endpointId: WebhookEndpointId;
  readonly appId: AppId;
  readonly eventId: string;
  readonly eventType: string;
  readonly body: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: Date | null;

  constructor(props: WebhookDeliveryProps) {
    super(props.id, props);
    this.endpointId = props.endpointId;
    this.appId = props.appId;
    this.eventId = props.eventId;
    this.eventType = props.eventType;
    this.body = props.body;
    this.status = props.status ?? 'pending';
    this.attempts = props.attempts ?? 0;
    this.nextAttemptAt = props.nextAttemptAt === undefined ? (this.status === 'pending' ? this.createdAt : null) : props.nextAttemptAt;
    this.lastStatusCode = props.lastStatusCode ?? null;
    this.lastError = props.lastError ?? null;
    this.deliveredAt = props.deliveredAt ?? null;
  }

  recordSuccess(statusCode: number, at: Date): void {
    this.attempts += 1;
    this.status = 'delivered';
    this.lastStatusCode = statusCode;
    this.lastError = null;
    this.nextAttemptAt = null;
    this.deliveredAt = at;
    this.touch(at);
  }

  /** `retry: false` (gửi thử) -> hết lượt ngay. */
  recordFailure(failure: { statusCode: number | null; error: string }, at: Date, retry = true): void {
    this.attempts += 1;
    this.lastStatusCode = failure.statusCode;
    this.lastError = failure.error.slice(0, MAX_ERROR_LENGTH);
    const next = retry ? nextAttemptAt(this.attempts, at) : null;
    this.nextAttemptAt = next;
    this.status = next === null ? 'failed' : 'pending';
    this.touch(at);
  }

  /** URL bị tắt / xoá: không gọi nữa. */
  abandon(reason: string, at: Date): void {
    this.status = 'failed';
    this.lastError = reason;
    this.nextAttemptAt = null;
    this.touch(at);
  }
}
