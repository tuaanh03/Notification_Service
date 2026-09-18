import type { AppId, TopicStatus } from '../../../../shared/kernel/index.ts';
import type { Topic } from '../../domain/entities/topic.ts';

export interface TopicRepository {
  findByKey(appId: AppId, key: string): Promise<Topic | null>;
  listByApp(appId: AppId): Promise<Topic[]>;
  /** Trùng key trong app -> ConflictError `TOPIC_KEY_TAKEN`. */
  insert(topic: Topic): Promise<void>;
  /** Ghi có điều kiện theo trạng thái lúc đọc -> ConcurrentTransitionError (409) nếu bên kia đổi trước. */
  update(topic: Topic, expectedStatus: TopicStatus): Promise<void>;
}
