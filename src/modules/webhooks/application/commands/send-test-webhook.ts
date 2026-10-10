import type { UnitOfWork } from '../../../../shared/application/index.ts';
import { WebhookDeliveryId, WebhookEventId, type AppId, type Clock, type WebhookEndpointId } from '../../../../shared/kernel/index.ts';
import { WebhookDelivery } from '../../domain/entities/webhook-delivery.ts';
import { toWebhookDeliveryDto, type WebhookDeliveryDto } from '../dto.ts';
import type { WebhookDeliveryRepository, WebhookEndpointRepository, WebhookSecrets, WebhookTransport } from '../ports/index.ts';
import { requireConfigured, requireEndpoint, webhookBody, webhookHeaders } from './shared.ts';

/**
 * Nút "Gửi thử": gọi NGAY một sự kiện `ping` (đã ký như thật) và trả kết quả. Không gọi lại khi lỗi —
 * người bấm thấy kết quả tức thì và tự bấm lại. Lượt này vẫn ghi vào nhật ký. Gọi được cả khi URL đang tắt.
 */
export class SendTestWebhook {
  private readonly deps: {
    uow: UnitOfWork;
    clock: Clock;
    endpoints: WebhookEndpointRepository;
    deliveries: WebhookDeliveryRepository;
    secrets: WebhookSecrets;
    transport: WebhookTransport;
  };

  constructor(deps: SendTestWebhook['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; endpointId: WebhookEndpointId }): Promise<WebhookDeliveryDto> {
    const { uow, clock, endpoints, deliveries, secrets, transport } = this.deps;
    requireConfigured(secrets);
    const endpoint = await requireEndpoint(endpoints, input.appId, input.endpointId);
    const now = clock.now();
    const eventId = WebhookEventId.create();
    const delivery = new WebhookDelivery({
      id: WebhookDeliveryId.create(),
      endpointId: endpoint.id,
      appId: endpoint.appId,
      eventId,
      eventType: 'ping',
      body: webhookBody({ id: eventId, type: 'ping', createdAt: now, data: {} }),
      nextAttemptAt: null,
      createdAt: now,
    });
    const result = await transport.post({ url: endpoint.url, body: delivery.body, headers: webhookHeaders(secrets, endpoint, delivery, now) });
    if (result.kind === 'ok') delivery.recordSuccess(result.statusCode, clock.now());
    else delivery.recordFailure(result, clock.now(), false);
    await uow.run(() => deliveries.insertIfAbsent(delivery));
    return toWebhookDeliveryDto(delivery);
  }
}
