import type { IntegrationEvent } from '../application/ports/event-outbox.ts';

/**
 * Tên stream — nguồn DUY NHẤT (tài liệu kiến trúc §8.1). Stream là HÀNG ĐỢI công việc, không phải
 * lịch sử: lịch sử nằm ở MySQL (`notification_transitions`, `audit_log`).
 */
export const STREAMS = {
  NOTIF_QUEUED: 'notif.queued',
  DELIVERY_EMAIL: 'delivery.email',
  DELIVERY_IN_APP: 'delivery.in_app',
  DELIVERY_RESULT: 'delivery.result',
  DIRECTORY_TAGS: 'directory.tags',
  DIRECTORY_IMPORT: 'directory.import',
  DIRECTORY_SYNC: 'directory.sync',
  AUDIT_EVENTS: 'audit.events',
} as const;
export type StreamName = (typeof STREAMS)[keyof typeof STREAMS];

/** Message lỗi vĩnh viễn / quá số lần giao được chuyển sang đây, hiển thị ở /admin/errors. */
export function dlqOf(stream: string): string {
  return `${stream}.dlq`;
}

/**
 * Event nào đi stream nào, NGOÀI `audit.events`. Module định nghĩa event mới mà cần worker xử lý
 * thì thêm một dòng ở đây — không XADD thẳng từ command.
 */
export const EVENT_ROUTES: Readonly<Record<string, readonly StreamName[]>> = {
  NotificationQueued: [STREAMS.NOTIF_QUEUED],
};

/**
 * Mọi domain event đều vào `audit.events` (audit append-only nghe tất cả), cộng các stream
 * công việc khai trong EVENT_ROUTES. Một event -> một dòng outbox cho MỖI stream đích.
 */
export function routeEvent(event: IntegrationEvent): readonly string[] {
  return [STREAMS.AUDIT_EVENTS, ...(EVENT_ROUTES[event.eventType] ?? [])];
}
