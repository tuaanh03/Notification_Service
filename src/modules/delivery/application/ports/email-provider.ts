/** Một email đã sẵn sàng gửi — không còn gì phải tra hay render. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string | null;
  /** Gắn vào header `X-EWS-Notification-Id` để truy vết thư ngược về notification. */
  notificationId: string;
}

/**
 * Kết quả MỘT lần gọi provider — đã phân loại theo câu hỏi duy nhất quan trọng với at-most-once
 * (ADR-0016 D3): "provider đã nhận thư chưa?"
 *
 *   accepted  — đã nhận (Graph 202). Coi là `sent`.
 *   retryable — CHẮC CHẮN CHƯA nhận (429, 503 kèm Retry-After, không kết nối được). Thử lại an toàn.
 *   rejected  — từ chối vĩnh viễn (4xx khác). Không thử lại.
 *   unknown   — KHÔNG BIẾT (timeout / đứt kết nối sau khi đã gửi request). Không bao giờ thử lại.
 *
 * Provider KHÔNG ném lỗi cho các trường hợp này — mọi lỗi đều đổi thành một trong bốn loại.
 */
export type EmailSendResult =
  | { kind: 'accepted'; providerMessageId: string | null }
  | { kind: 'retryable'; reason: string; retryAfterMs: number | null }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unknown'; reason: string };

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<EmailSendResult>;
}
