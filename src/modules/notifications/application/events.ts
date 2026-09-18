import type { Actor } from '../../../shared/application/index.ts';

export const NOTIFICATION_AGGREGATE = 'Notification';

/**
 * `NotificationQueued` đi thêm stream `notif.queued` (EVENT_ROUTES) — worker `email-sender` nghe ở đó.
 * Các event còn lại chỉ vào `audit.events`.
 */
export const NOTIFICATION_EVENTS = {
  queued: 'NotificationQueued',
  noRecipient: 'NotificationNoRecipient',
  sent: 'NotificationSent',
  failed: 'NotificationFailed',
} as const;

/** Actor của mọi chuyển trạng thái do worker / job làm. */
export const EMAIL_SENDER_ACTOR: Actor = { id: 'email-sender', type: 'system' };

/** Lý do `failed` khi không biết provider đã nhận thư chưa (at-most-once — ADR-0016 D3). */
export const OUTCOME_UNKNOWN = 'outcome_unknown';
