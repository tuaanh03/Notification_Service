import type { TopicId, UserId } from '../../../../shared/kernel/index.ts';
import type { UserTopicPreference } from '../../domain/entities/user-topic-preference.ts';

export interface PreferenceRepository {
  listByUser(userId: UserId): Promise<UserTopicPreference[]>;
  find(userId: UserId, topicId: TopicId): Promise<UserTopicPreference | null>;
  /** Một dòng mỗi (user, topic) — ghi đè nếu đã có. */
  upsert(preference: UserTopicPreference): Promise<void>;
}
