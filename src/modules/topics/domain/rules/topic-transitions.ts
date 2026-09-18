import { InvalidTransitionError, type TopicStatus } from '../../../../shared/kernel/index.ts';

/**
 * Vòng đời topic. `draft` để admin chuẩn bị (app service chưa thấy, chưa gửi được); `suspended` tạm
 * ngừng nhận tin mới trên topic mà không mất preference của người dùng.
 */
export const TOPIC_TRANSITIONS = {
  draft: { activate: 'active' },
  active: { suspend: 'suspended' },
  suspended: { activate: 'active' },
} as const satisfies Record<TopicStatus, Readonly<Record<string, TopicStatus>>>;

export type TopicTransitionEvent = {
  [S in keyof typeof TOPIC_TRANSITIONS]: keyof (typeof TOPIC_TRANSITIONS)[S];
}[keyof typeof TOPIC_TRANSITIONS];

export function nextTopicStatus(from: TopicStatus, event: TopicTransitionEvent): TopicStatus {
  const next = (TOPIC_TRANSITIONS as Record<TopicStatus, Record<string, TopicStatus>>)[from][event];
  if (!next) throw new InvalidTransitionError('Topic', from, event);
  return next;
}
