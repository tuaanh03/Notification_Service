import type { UnitOfWork } from '../../../../shared/application/index.ts';
import type { Logger } from '../../../../shared/observability/logger.ts';
import type { Clock } from '../../../../shared/kernel/index.ts';
import type { WebhookDelivery } from '../../domain/entities/webhook-delivery.ts';
import type { WebhookDeliveryRepository, WebhookEndpointRepository, WebhookSecrets, WebhookTransport } from '../ports/index.ts';
import { webhookHeaders } from './shared.ts';

/** Mỗi lần job chạy nhận tối đa chừng này lượt, gọi song song. */
export const WEBHOOK_BATCH_SIZE = 20;
/**
 * Lượt đã nhận được giữ chừng này trước khi coi như process đã chết và cho lượt khác nhận lại. Phải dài
 * hơn timeout một lần gọi (10 giây) nhiều lần.
 */
export const WEBHOOK_LEASE_MS = 120_000;

/**
 * Job `deliver-webhooks` (ADR-0029 §6): nhận lượt đến hạn (tx ngắn) -> gọi ra ngoài NGOÀI transaction ->
 * ghi kết quả có điều kiện (tx ngắn). Không giữ transaction trong lúc chờ app trả lời.
 */
export class DeliverDueWebhooks {
  private readonly deps: {
    uow: UnitOfWork;
    clock: Clock;
    logger: Logger;
    endpoints: WebhookEndpointRepository;
    deliveries: WebhookDeliveryRepository;
    secrets: WebhookSecrets;
    transport: WebhookTransport;
  };

  constructor(deps: DeliverDueWebhooks['deps']) {
    this.deps = deps;
  }

  /** Trả số lượt đã xử lý (0 khi chưa cấu hình khoá ký). */
  async execute(): Promise<number> {
    const { uow, clock, deliveries, secrets } = this.deps;
    if (!secrets.configured) return 0;
    const now = clock.now();
    const claimed = await uow.run(() => deliveries.claimDue(now, new Date(now.getTime() + WEBHOOK_LEASE_MS), WEBHOOK_BATCH_SIZE));
    await Promise.all(claimed.map((delivery) => this.deliver(delivery)));
    return claimed.length;
  }

  private async deliver(delivery: WebhookDelivery): Promise<void> {
    const { uow, clock, logger, endpoints, deliveries, secrets, transport } = this.deps;
    const expectedAttempts = delivery.attempts;
    const endpoint = await endpoints.findById(delivery.endpointId);
    if (!endpoint || endpoint.status !== 'active') {
      delivery.abandon('endpoint_disabled', clock.now());
    } else {
      const result = await transport.post({
        url: endpoint.url,
        body: delivery.body,
        headers: webhookHeaders(secrets, endpoint, delivery, clock.now()),
      });
      if (result.kind === 'ok') delivery.recordSuccess(result.statusCode, clock.now());
      else delivery.recordFailure(result, clock.now());
    }
    const saved = await uow.run(() => deliveries.saveResult(delivery, expectedAttempts));
    if (!saved) logger.warn('webhook delivery result discarded: another attempt recorded first', { deliveryId: delivery.id });
  }
}
