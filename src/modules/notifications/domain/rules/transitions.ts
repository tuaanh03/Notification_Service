import {
  InvalidTransitionError,
  TERMINAL_STATUSES,
  type NotificationStatus,
} from '../../../../shared/kernel/index.ts';

/**
 * BẢNG CHUYỂN TRẠNG THÁI DUY NHẤT của notification (SM §4).
 *
 * Toàn bộ vòng đời xoay quanh một câu hỏi: ĐÃ CÓ THƯ NÀO RỜI HỆ THỐNG CHƯA?
 * Vạch phân chia là `queued -> sending`:
 *   - trước vạch: còn Huỷ được (cancel)
 *   - sau vạch:  chỉ còn Dừng được (stop), và con số đã gửi là con số thật
 *
 * 6 trạng thái kết thúc KHÔNG có dòng nào -> không quay lui (SM-2).
 * Gửi lại / đính chính = bản ghi MỚI với parent_notification_id, không phải quay ngược.
 */
export const TRANSITIONS = {
  draft: {
    submit: 'queued',
    submit_over_threshold: 'pending_approval',
    schedule: 'scheduled',
  },
  pending_approval: {
    approve: 'queued',
    reject: 'draft',
  },
  scheduled: {
    due: 'queued',
    unschedule: 'draft',
    cancel: 'cancelled',
  },
  queued: {
    first_batch_left: 'sending',
    cancel: 'cancelled',
    zero_recipients: 'no_recipient',
    fail: 'failed',
  },
  sending: {
    all_accepted: 'sent',
    some_failed: 'partially_failed',
    stop: 'stopped',
    all_failed: 'failed',
  },
  // sent · partially_failed · no_recipient · stopped · cancelled · failed:
  // không có dòng -> trạng thái kết thúc.
} as const satisfies Partial<Record<NotificationStatus, Readonly<Record<string, NotificationStatus>>>>;

export type TransitionTable = typeof TRANSITIONS;
export type TransitionSource = keyof TransitionTable;
export type TransitionEvent = {
  [S in TransitionSource]: keyof TransitionTable[S];
}[TransitionSource];

const TERMINAL = new Set<NotificationStatus>(TERMINAL_STATUSES);

export function isTerminal(status: NotificationStatus): boolean {
  return TERMINAL.has(status);
}

/** Trạng thái kế tiếp, hoặc throw. Không ai được set `status` bằng cách khác. */
export function nextStatus(from: NotificationStatus, event: TransitionEvent): NotificationStatus {
  const table = TRANSITIONS as Partial<Record<NotificationStatus, Record<string, NotificationStatus>>>;
  const next = table[from]?.[event];
  if (!next) throw new InvalidTransitionError('Notification', from, event);
  return next;
}

export function canTransition(from: NotificationStatus, event: TransitionEvent): boolean {
  const table = TRANSITIONS as Partial<Record<NotificationStatus, Record<string, NotificationStatus>>>;
  return table[from]?.[event] !== undefined;
}

/** Mọi event hợp lệ từ một trạng thái — dùng cho UI và cho test bao phủ. */
export function eventsFrom(from: NotificationStatus): readonly string[] {
  const table = TRANSITIONS as Partial<Record<NotificationStatus, Record<string, NotificationStatus>>>;
  return Object.keys(table[from] ?? {});
}
