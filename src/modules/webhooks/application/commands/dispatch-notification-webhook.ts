import type { UnitOfWork } from '../../../../shared/application/index.ts';
import {
  AppId,
  NotFoundError,
  WebhookDeliveryId,
  WebhookEventId,
  type Clock,
  type NotificationId,
} from '../../../../shared/kernel/index.ts';
import { WebhookDelivery } from '../../domain/entities/webhook-delivery.ts';
import { NOTIFICATION_EVENT_TO_WEBHOOK } from '../events.ts';
import type { NotificationOutcomes, WebhookDeliveryRepository, WebhookEndpointRepository } from '../ports/index.ts';
import { webhookBody } from './shared.ts';

export type NotificationOutcomeEvent = keyof typeof NOTIFICATION_EVENT_TO_WEBHOOK;

/**
 * Consumer `webhook-dispatcher` (ADR-0029 §6): một thư có kết quả -> mỗi URL của app có đăng ký sự kiện
 * đó một lượt gọi `pending`. CHỈ ghi DB, không gọi ra ngoài — job `deliver-webhooks` gọi. Chạy trong
 * transaction của khung consumer (khử trùng theo outbox id), nên mỗi sự kiện chỉ tạo lượt đúng một lần.
 */
export class DispatchNotificationWebhook {
  private readonly deps: {
    uow: UnitOfWork;
    clock: Clock;
    outcomes: NotificationOutcomes;
    endpoints: WebhookEndpointRepository;
    deliveries: WebhookDeliveryRepository;
  };

  constructor(deps: DispatchNotificationWebhook['deps']) {
    this.deps = deps;
  }

  /** Trả số lượt đã tạo. */
  async execute(input: { event: NotificationOutcomeEvent; notificationId: NotificationId }): Promise<number> {
    const { uow, clock, outcomes, endpoints, deliveries } = this.deps;
    const type = NOTIFICATION_EVENT_TO_WEBHOOK[input.event];
    const outcome = await outcomes.get(input.notificationId);
    if (!outcome) throw new NotFoundError('notification', input.notificationId);
    const appId = AppId.parse(outcome.appId);

    const targets = (await endpoints.listByApp(appId)).filter((e) => e.subscribesTo(type));
    if (targets.length === 0) return 0;

    const now = clock.now();
    // Một sự kiện, MỘT id — mọi URL của app nhận cùng id (app gom được bản trùng giữa hai URL nếu muốn).
    const eventId = WebhookEventId.create();
    const body = webhookBody({
      id: eventId,
      type,
      createdAt: now,
      data: {
        notificationId: outcome.notificationId,
        publicationId: outcome.publicationId,
        externalId: outcome.externalId,
        topic: outcome.topic,
        status: outcome.status,
        exclusionReason: outcome.exclusionReason,
        error: outcome.error,
      },
    });
    await uow.run(async () => {
      for (const endpoint of targets) {
        await deliveries.insertIfAbsent(
          new WebhookDelivery({
            id: WebhookDeliveryId.create(),
            endpointId: endpoint.id,
            appId,
            eventId,
            eventType: type,
            body,
            createdAt: now,
          }),
        );
      }
    });
    return targets.length;
  }
}
