import { NotFoundError, type AppId, type WebhookEndpointId } from '../../../../shared/kernel/index.ts';
import type { WebhookEndpoint } from '../../domain/entities/webhook-endpoint.ts';
import type { WebhookEndpointRepository, WebhookSecrets } from '../ports/index.ts';
import { webhookNotConfigured } from '../errors.ts';

/** URL của app khác trả 404 — như thể không tồn tại. */
export async function requireEndpoint(
  endpoints: WebhookEndpointRepository,
  appId: AppId,
  id: WebhookEndpointId,
): Promise<WebhookEndpoint> {
  const endpoint = await endpoints.findById(id);
  if (!endpoint || endpoint.appId !== appId) throw new NotFoundError('webhook', id);
  return endpoint;
}

export function requireConfigured(secrets: WebhookSecrets): void {
  if (!secrets.configured) throw webhookNotConfigured();
}

/**
 * Body gửi cho app — chốt MỘT lần thành chuỗi, mọi lần gọi lại gửi y hệt (chữ ký ký trên đúng chuỗi này).
 * `id` cố định qua các lần gọi lại: app bỏ bản trùng theo nó.
 */
export function webhookBody(event: { id: string; type: string; createdAt: Date; data: Record<string, unknown> }): string {
  return JSON.stringify({ id: event.id, type: event.type, createdAt: event.createdAt.toISOString(), data: event.data });
}

/** Header của MỘT lần gọi. Chữ ký tính lại mỗi lần (có giờ ký) — body thì không đổi. */
export function webhookHeaders(
  secrets: WebhookSecrets,
  endpoint: WebhookEndpoint,
  delivery: { id: string; eventType: string; body: string },
  at: Date,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'user-agent': 'EWS-Webhook/1',
    'x-ews-event': delivery.eventType,
    'x-ews-delivery-id': delivery.id,
    'x-ews-signature': secrets.signatureHeader(endpoint.id, endpoint.secretVersion, delivery.body, at),
  };
}
