export const TOPIC_AGGREGATE = 'Topic';
/** Thay đổi preference audit theo USER — lịch sử của một người nằm cùng một chỗ. */
export const USER_AGGREGATE = 'User';

export const TOPIC_EVENTS = {
  created: 'TopicCreated',
  activated: 'TopicActivated',
  suspended: 'TopicSuspended',
  preferenceChanged: 'UserTopicPreferenceChanged',
} as const;
