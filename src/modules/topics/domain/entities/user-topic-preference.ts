import {
  type PreferenceSource,
  type TopicId,
  type UserId,
} from '../../../../shared/kernel/index.ts';

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
    updatedAt: Date;
  }) {
    this.userId = props.userId;
    this.topicId = props.topicId;
    this.optedIn = props.optedIn;
    this.source = props.source;
    this.updatedAt = props.updatedAt;
  }

  set(optedIn: boolean, source: PreferenceSource, at: Date): void {
    this.optedIn = optedIn;
    this.source = source;
    this.updatedAt = at;
  }
}
