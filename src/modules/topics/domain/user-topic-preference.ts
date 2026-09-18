import {
  ValidationError,
  type PreferenceSource,
  type TopicId,
  type UserId,
} from '../../../shared/kernel/index.ts';
import type { Topic } from './topic.ts';

/** PK (user_id, topic_id). Không có dòng = dùng `defaultMode` của topic. */
export class UserTopicPreference {
  readonly userId: UserId;
  readonly topicId: TopicId;
  optedIn: boolean;
  source: PreferenceSource;
  updatedAt: Date;

  constructor(props: {
    userId: UserId;
    topicId: TopicId;
    optedIn: boolean;
    source: PreferenceSource;
    updatedAt?: Date | undefined;
  }) {
    this.userId = props.userId;
    this.topicId = props.topicId;
    this.optedIn = props.optedIn;
    this.source = props.source;
    this.updatedAt = props.updatedAt ?? new Date();
  }

  set(optedIn: boolean, source: PreferenceSource, at: Date): void {
    this.optedIn = optedIn;
    this.source = source;
    this.updatedAt = at;
  }
}

/**
 * Consent hiệu lực của một user với một topic.
 * Ý muốn của user (consent) luôn thắng ý muốn của hệ thống (targeting) —
 * ngoại lệ duy nhất là topic mandatory.
 */
export function effectiveOptIn(
  topic: Topic,
  preference: Pick<UserTopicPreference, 'optedIn'> | null,
): boolean {
  if (topic.mandatory) return true;
  return preference ? preference.optedIn : topic.defaultOptedIn;
}

export function assertTopicIsTurnableOff(topic: Topic): void {
  if (topic.mandatory) {
    throw new ValidationError([`topic ${topic.key} là mandatory, không tắt được`]);
  }
}
