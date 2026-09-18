import { and, asc, eq } from 'drizzle-orm';
import { duplicateKeyName, type TransactionContext } from '../../../../shared/db/index.ts';
import {
  AppId,
  CHANNELS,
  ConcurrentTransitionError,
  ConflictError,
  TopicId,
  type AppId as AppIdType,
  type Channel,
  type TopicStatus,
} from '../../../../shared/kernel/index.ts';
import type { TopicRepository } from '../../application/ports/index.ts';
import { Topic } from '../../domain/entities/topic.ts';
import { topics } from '../db/schema.ts';

type Row = typeof topics.$inferSelect;
type WriteResult = [{ affectedRows: number }, unknown];
const KNOWN_CHANNELS = new Set<string>(CHANNELS);

export class DrizzleTopicRepository implements TopicRepository {
  private readonly transactions: TransactionContext;

  constructor(deps: { transactions: TransactionContext }) {
    this.transactions = deps.transactions;
  }

  async findByKey(appId: AppIdType, key: string): Promise<Topic | null> {
    const [row] = await this.transactions
      .executor()
      .select()
      .from(topics)
      .where(and(eq(topics.appId, appId), eq(topics.key, key)));
    return row ? toTopic(row) : null;
  }

  async listByApp(appId: AppIdType): Promise<Topic[]> {
    const rows = await this.transactions.executor().select().from(topics).where(eq(topics.appId, appId)).orderBy(asc(topics.key));
    return rows.map(toTopic);
  }

  async insert(topic: Topic): Promise<void> {
    try {
      await this.transactions.executor().insert(topics).values({
        topicId: topic.id,
        appId: topic.appId,
        key: topic.key,
        name: topic.name,
        status: topic.status,
        defaultMode: topic.defaultMode,
        mandatory: topic.mandatory,
        defaultChannels: [...topic.defaultChannels],
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt,
      });
    } catch (err) {
      if (duplicateKeyName(err) === 'uq_topics_app_key') {
        throw new ConflictError('TOPIC_KEY_TAKEN', `topic key ${topic.key} is already used in this app`);
      }
      throw err;
    }
  }

  async update(topic: Topic, expectedStatus: TopicStatus): Promise<void> {
    const [result] = (await this.transactions
      .executor()
      .update(topics)
      .set({ name: topic.name, status: topic.status, updatedAt: topic.updatedAt })
      .where(and(eq(topics.topicId, topic.id), eq(topics.status, expectedStatus)))) as unknown as WriteResult;
    if (result.affectedRows === 0) throw new ConcurrentTransitionError('Topic', topic.id, expectedStatus);
  }
}

function toTopic(row: Row): Topic {
  return new Topic({
    id: TopicId.parse(row.topicId),
    appId: AppId.parse(row.appId),
    key: row.key,
    name: row.name,
    status: row.status,
    defaultMode: row.defaultMode,
    mandatory: row.mandatory,
    defaultChannels: row.defaultChannels.filter((c): c is Channel => KNOWN_CHANNELS.has(c)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
