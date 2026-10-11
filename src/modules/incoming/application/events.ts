export const INCOMING_HOOK_AGGREGATE = 'IncomingHook';

/** Chỉ vào `audit.events`. Từng lần gọi vào không audit riêng — lần phát đã có `TopicPublished` (nguồn incoming_webhook). */
export const INCOMING_HOOK_EVENTS = {
  created: 'IncomingHookCreated',
  updated: 'IncomingHookUpdated',
  tokenRotated: 'IncomingHookTokenRotated',
  /** Ai đó lấy URL đầy đủ — URL là chìa khoá, nên mỗi lần lấy đều ghi lại. */
  urlRevealed: 'IncomingHookUrlRevealed',
  deleted: 'IncomingHookDeleted',
} as const;
