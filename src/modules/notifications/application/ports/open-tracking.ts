import type { AppId, NotificationId } from '../../../../shared/kernel/index.ts';

/**
 * -> apps + settings: thư của app này có chèn ảnh đếm "đã mở" không (ADR-0031). Trả domain API công
 * khai để ghép URL ảnh khi app BẬT đếm VÀ Super Admin đã khai `api.public_base_url`; null = không chèn.
 */
export interface OpenTrackingConfig {
  publicBaseUrlFor(appId: AppId): Promise<string | null>;
}

/**
 * Chữ ký trên URL ảnh — không lưu, tính lại từ `WEBHOOK_SIGNING_KEY` (cùng cách token incoming webhook).
 * Chặn người ngoài tự ghép URL để đếm khống cho notification bất kỳ.
 */
export interface OpenTrackingSigner {
  /** false = server thiếu khoá: không chèn ảnh, đường ảnh không ghi gì. */
  readonly configured: boolean;
  sign(notificationId: NotificationId): string;
  verify(notificationId: NotificationId, signature: string): boolean;
}
