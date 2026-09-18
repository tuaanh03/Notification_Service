import type { AppId } from '../../../../shared/kernel/index.ts';
import { toPublicTopicDto, toTopicDto, type PublicTopicDto, type TopicDto } from '../dto.ts';
import type { TopicRepository } from '../ports/index.ts';

export class TopicQueries {
  private readonly topics: TopicRepository;

  constructor(deps: { topics: TopicRepository }) {
    this.topics = deps.topics;
  }

  /** Console quản trị: mọi trạng thái. */
  async listForAdmin(appId: AppId): Promise<TopicDto[]> {
    return (await this.topics.listByApp(appId)).map(toTopicDto);
  }

  /** App service: chỉ topic đang `active` — draft / suspended không gửi được nên không lộ ra. */
  async listActive(appId: AppId): Promise<PublicTopicDto[]> {
    return (await this.topics.listByApp(appId)).filter((t) => t.status === 'active').map(toPublicTopicDto);
  }
}
