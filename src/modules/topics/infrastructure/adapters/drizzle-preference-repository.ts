import { and, eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/db/index.ts';
import { TopicId, UserId, type TopicId as TopicIdType, type UserId as UserIdType } from '../../../../shared/kernel/index.ts';
import type { PreferenceRepository } from '../../application/ports/index.ts';
import { UserTopicPreference } from '../../domain/entities/user-topic-preference.ts';
import { userTopicPreferences } from '../db/schema.ts';

export class DrizzlePreferenceRepository implements PreferenceRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async listByUser(userId: UserIdType): Promise<UserTopicPreference[]> {
    const rows = await this.transactions
      .executor()
      .select()
      .from(userTopicPreferences)
      .where(eq(userTopicPreferences.userId, userId));
    return rows.map(toPreference);
  }

  async find(userId: UserIdType, topicId: TopicIdType): Promise<UserTopicPreference | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(userTopicPreferences)
      .where(and(eq(userTopicPreferences.userId, userId), eq(userTopicPreferences.topicId, topicId)));
    return row ? toPreference(row) : null;
  }

  /** INSERT ... ON DUPLICATE KEY UPDATE trên PK (user_id, topic_id): hai request cùng ghi không lỗi, bên sau thắng. */
  async upsert(p: UserTopicPreference): Promise<void> {
    await this.transactions
      .executor()
      .insert(userTopicPreferences)
      .values({ userId: p.userId, topicId: p.topicId, optedIn: p.optedIn, source: p.source, updatedAt: p.updatedAt })
      .onDuplicateKeyUpdate({ set: { optedIn: p.optedIn, source: p.source, updatedAt: p.updatedAt } });
  }
}

function toPreference(row: typeof userTopicPreferences.$inferSelect): UserTopicPreference {
  return new UserTopicPreference({
    userId: UserId.parse(row.userId),
    topicId: TopicId.parse(row.topicId),
    optedIn: row.optedIn,
    source: row.source,
    updatedAt: row.updatedAt,
  });
}
