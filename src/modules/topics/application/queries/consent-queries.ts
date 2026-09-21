import type { AppId, TopicId, UserId } from '../../../../shared/kernel/index.ts';
import type { Topic } from '../../domain/entities/topic.ts';
import type { PreferenceRepository, TopicRepository } from '../ports/index.ts';

/** Những gì module gửi tin cần biết về một topic để áp consent. */
export interface ConsentTopicView {
  topicId: TopicId;
  key: string;
  status: string;
  mandatory: boolean;
  /** Suy từ defaultMode: 'opt_out' -> true (mặc định nhận). */
  defaultOptedIn: boolean;
}

/**
 * Query công khai cho notifications (API kiểm topic lúc nhận, worker áp L3 lúc gửi). Trả dữ liệu thô —
 * rule consent chạy ở phía gọi bằng `effectiveOptIn`, không chạy ở đây.
 */
export class ConsentQueries {
  private readonly deps: { topics: TopicRepository; preferences: PreferenceRepository };

  constructor(deps: ConsentQueries['deps']) {
    this.deps = deps;
  }

  async topicByKey(appId: AppId, key: string): Promise<ConsentTopicView | null> {
    const topic = await this.deps.topics.findByKey(appId, key);
    return topic ? view(topic) : null;
  }

  async topicById(topicId: TopicId): Promise<ConsentTopicView | null> {
    const topic = await this.deps.topics.findById(topicId);
    return topic ? view(topic) : null;
  }

  /**
   * Mọi topic của MỘT app, một truy vấn — cho màn danh sách đổi `topic_id` ra `key` theo lô.
   * Topic mỗi app chỉ vài chục, nên lấy cả app rẻ hơn và đơn giản hơn tra theo từng id.
   */
  async topicsByApp(appId: AppId): Promise<ConsentTopicView[]> {
    return (await this.deps.topics.listByApp(appId)).map(view);
  }

  /** null = user chưa chọn gì cho topic này. */
  async preference(userId: UserId, topicId: TopicId): Promise<{ optedIn: boolean } | null> {
    const preference = await this.deps.preferences.find(userId, topicId);
    return preference ? { optedIn: preference.optedIn } : null;
  }
}

const view = (t: Topic): ConsentTopicView => ({
  topicId: t.id,
  key: t.key,
  status: t.status,
  mandatory: t.mandatory,
  defaultOptedIn: t.defaultOptedIn,
});
