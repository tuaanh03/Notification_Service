import type { MessageHandler } from '../../../../shared/streams/contracts.ts';
import { PermanentMessageError } from '../../../../shared/streams/contracts.ts';
import { NotificationId } from '../../../../shared/kernel/index.ts';
import type { DispatchNotificationWebhook, NotificationOutcomeEvent } from '../../application/index.ts';
import { NOTIFICATION_EVENT_TO_WEBHOOK } from '../../application/index.ts';

const isOutcomeEvent = (type: string): type is NotificationOutcomeEvent => Object.hasOwn(NOTIFICATION_EVENT_TO_WEBHOOK, type);

/**
 * Consumer group `webhook-dispatcher` trên stream `webhook.events` (ADR-0029). Chế độ mặc định của khung
 * (transaction + khử trùng theo outbox id): chỉ ghi lượt gọi vào DB, không gọi ra ngoài.
 */
export function webhookDispatcherHandler(useCases: { dispatch: DispatchNotificationWebhook }): MessageHandler {
  return async (message) => {
    if (!isOutcomeEvent(message.eventType)) {
      throw new PermanentMessageError(`message ${message.id} has unexpected event type ${message.eventType}`);
    }
    if (!NotificationId.is(message.aggregateId)) {
      throw new PermanentMessageError(`message ${message.id} carries an invalid notification id`);
    }
    await useCases.dispatch.execute({ event: message.eventType, notificationId: NotificationId.parse(message.aggregateId) });
  };
}
