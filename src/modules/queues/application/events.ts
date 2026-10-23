export const QUEUE_AGGREGATE = 'DeliveryQueue';
/** aggregateId cố định — hàng đợi không có id riêng trong DB; stream / group / message nằm trong payload. */
export const QUEUE_ID = '00000000-0000-4000-8000-000000000002';

/** Chỉ vào `audit.events` (ADR-0042). */
export const QUEUE_EVENTS = {
  deadLetterRequeued: 'DeadLetterRequeued',
  deadLetterDiscarded: 'DeadLetterDiscarded',
  groupPaused: 'ConsumerGroupPaused',
  groupResumed: 'ConsumerGroupResumed',
} as const;
