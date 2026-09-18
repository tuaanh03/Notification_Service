import type { UserId } from '../../../../shared/kernel/index.ts';
import type { UserTopicPreference } from '../../domain/entities/user-topic-preference.ts';

export interface PreferenceRepository {
  listByUser(userId: UserId): Promise<UserTopicPreference[]>;
  /** Một dòng mỗi (user, topic) — ghi đè nếu đã có. */
  upsert(preference: UserTopicPreference): Promise<void>;
}
