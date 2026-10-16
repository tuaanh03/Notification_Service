import type { AppId, NotificationId } from '../../../../shared/kernel/index.ts';

/**
 * -> apps + settings: cờ đếm "đã mở" của app (ADR-0031) + domain API công khai để ghép URL ảnh
 * (`api.public_base_url`, null = Super Admin chưa khai). Chèn ảnh khi `enabled` VÀ có domain.
 */
export interface OpenTrackingConfig {
  forApp(appId: AppId): Promise<{ enabled: boolean; publicBaseUrl: string | null }>;
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
