import type { WebhookDelivery } from '../domain/entities/webhook-delivery.ts';
import type { WebhookEndpoint } from '../domain/entities/webhook-endpoint.ts';

/** Không bao giờ có secret — secret chỉ nằm trong response tạo / đổi secret (`IssuedWebhookSecretDto`). */
export interface WebhookEndpointDto {
  id: string;
  url: string;
  events: string[];
  /** active | disabled */
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssuedWebhookSecretDto {
  endpoint: WebhookEndpointDto;
  /** `whsec_…` — hiện MỘT lần, không lấy lại được (chỉ đổi được). */
  secret: string;
}

/** Một dòng nhật ký gọi. Không có body đã gửi, không có phản hồi của app. */
export interface WebhookDeliveryDto {
  id: string;
  eventId: string;
  eventType: string;
  /** pending | delivered | failed */
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export const toWebhookEndpointDto = (e: WebhookEndpoint): WebhookEndpointDto => ({
  id: e.id,
  url: e.url,
  events: [...e.events],
  status: e.status,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

export const toWebhookDeliveryDto = (d: WebhookDelivery): WebhookDeliveryDto => ({
  id: d.id,
  eventId: d.eventId,
  eventType: d.eventType,
  status: d.status,
  attempts: d.attempts,
  lastStatusCode: d.lastStatusCode,
  lastError: d.lastError,
  nextAttemptAt: iso(d.nextAttemptAt),
  createdAt: d.createdAt.toISOString(),
  deliveredAt: iso(d.deliveredAt),
});
