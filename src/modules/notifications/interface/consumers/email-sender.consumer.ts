import type { MessageHandler } from '../../../../shared/streams/contracts.ts';
import { PermanentMessageError } from '../../../../shared/streams/contracts.ts';
import { NotificationId } from '../../../../shared/kernel/index.ts';
import type { DeliverEmailNotification } from '../../application/index.ts';

/**
 * Consumer group `email-sender` trên stream `notif.queued`. Đăng ký với `idempotency: 'handler'`
 * (ADR-0016): khung KHÔNG bọc transaction — `DeliverEmailNotification` tự commit "đã nhận việc" trước
 * khi gọi provider, và tự khử trùng bằng trạng thái notification.
 */
export function emailSenderHandler(useCases: { deliver: DeliverEmailNotification }): MessageHandler {
  return async (message) => {
    if (!NotificationId.is(message.aggregateId)) {
      throw new PermanentMessageError(`message ${message.id} carries an invalid notification id`);
    }
    await useCases.deliver.execute(NotificationId.parse(message.aggregateId));
  };
}
