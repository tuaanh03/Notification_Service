export const INCOMING_HOOK_AGGREGATE = 'IncomingHook';

/** Chỉ vào `audit.events`. Từng lần gọi vào không audit riêng — lần phát đã có `TopicPublished` (nguồn incoming_webhook). */
export const INCOMING_HOOK_EVENTS = {
  created: 'IncomingHookCreated',
  updated: 'IncomingHookUpdated',
  tokenRotated: 'IncomingHookTokenRotated',
  deleted: 'IncomingHookDeleted',
} as const;
