import type { AppId, WebhookEndpointId } from '../../../../shared/kernel/index.ts';
import type { WebhookDelivery } from '../../domain/entities/webhook-delivery.ts';
import type { WebhookEndpoint } from '../../domain/entities/webhook-endpoint.ts';

export interface WebhookEndpointRepository {
  /** Chỗ `(app_id, slot)` đã có người giữ -> `WebhookSlotTakenError` (caller đọc lại rồi thử chỗ khác). */
  insert(endpoint: WebhookEndpoint): Promise<void>;
  findById(id: WebhookEndpointId): Promise<WebhookEndpoint | null>;
  listByApp(appId: AppId): Promise<WebhookEndpoint[]>;
  update(endpoint: WebhookEndpoint): Promise<void>;
  delete(id: WebhookEndpointId): Promise<void>;
}

export interface WebhookDeliveryRepository {
  /** Trùng `(endpoint_id, event_id)` -> bỏ qua im lặng (một sự kiện không thành hai lượt cho một URL). */
  insertIfAbsent(delivery: WebhookDelivery): Promise<void>;
  /**
   * Nhận tối đa `limit` lượt đến hạn (`pending`, `next_attempt_at <= now`) và dời `next_attempt_at` tới
   * `leaseUntil` — trong transaction, `FOR UPDATE SKIP LOCKED`: hai scheduler không nhận trùng. Lượt
   * nhận rồi mà process chết giữa chừng thì hết `leaseUntil` lại đến hạn (gọi ít nhất một lần).
   */
  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<WebhookDelivery[]>;
  /** Ghi kết quả CÓ ĐIỀU KIỆN `attempts = expectedAttempts`. false = lượt khác đã ghi trước (bỏ kết quả này). */
  saveResult(delivery: WebhookDelivery, expectedAttempts: number): Promise<boolean>;
  /** Mọi lượt còn `pending` của URL -> `failed` với lý do (URL bị tắt). */
  abandonPending(endpointId: WebhookEndpointId, reason: string, at: Date): Promise<void>;
  deleteByEndpoint(endpointId: WebhookEndpointId): Promise<void>;
  /** Mới nhất trước. */
  listRecent(endpointId: WebhookEndpointId, limit: number): Promise<WebhookDelivery[]>;
}
