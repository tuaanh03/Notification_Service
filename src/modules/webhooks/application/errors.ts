import { ConflictError, UpstreamError } from '../../../shared/kernel/index.ts';

/** Hai lệnh thêm URL cùng chọn một chỗ — bên thua đọc lại và thử chỗ khác. Không ra tới HTTP. */
export class WebhookSlotTakenError extends ConflictError {
  constructor() {
    super('WEBHOOK_SLOT_TAKEN', 'webhook slot was taken concurrently');
  }
}

/** Thiếu `WEBHOOK_SIGNING_KEY`: không ký được thì không tạo / đổi secret, không gọi ra ngoài. */
export function webhookNotConfigured(): UpstreamError {
  return new UpstreamError('WEBHOOK_NOT_CONFIGURED', 'webhooks are not configured on this server', 503);
}
