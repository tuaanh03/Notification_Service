import type { NotificationId, WebhookEndpointId } from '../../../../shared/kernel/index.ts';

/**
 * Secret của từng URL — KHÔNG lưu, tính lại từ khoá chủ `WEBHOOK_SIGNING_KEY` + id + phiên bản (ADR-0029
 * §7a). Thiếu khoá chủ -> `configured = false`: không tạo / đổi secret được, job không gọi gì.
 */
export interface WebhookSecrets {
  readonly configured: boolean;
  secretFor(endpointId: WebhookEndpointId, version: number): string;
  /** Giá trị header `X-EWS-Signature`: `t=<giây unix>,v1=<HMAC-SHA256(secret, "<t>.<body>") hex>`. */
  signatureHeader(endpointId: WebhookEndpointId, version: number, body: string, at: Date): string;
}

/** Kết quả MỘT lần gọi. `failed` gồm cả mã khác 2xx, quá giờ, không kết nối được, URL trỏ vào IP nội bộ. */
export type WebhookCallResult = { kind: 'ok'; statusCode: number } | { kind: 'failed'; statusCode: number | null; error: string };

export interface WebhookTransport {
  post(request: { url: string; body: string; headers: Readonly<Record<string, string>> }): Promise<WebhookCallResult>;
}

/** -> notifications: kết quả một lần gửi (không có địa chỉ email, không có nội dung). */
export interface NotificationOutcome {
  notificationId: string;
  appId: string;
  publicationId: string | null;
  externalId: string | null;
  topic: string;
  status: string;
  exclusionReason: string | null;
  error: string | null;
}

export interface NotificationOutcomes {
  get(id: NotificationId): Promise<NotificationOutcome | null>;
}
