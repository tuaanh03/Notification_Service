import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, TopicId, type AppId, type Clock, type TopicDefaultMode } from '../../../../shared/kernel/index.ts';
import { Topic } from '../../domain/entities/topic.ts';
import { toTopicDto, type TopicDto } from '../dto.ts';
import { TOPIC_AGGREGATE, TOPIC_EVENTS } from '../events.ts';
import type { AppLookup, TopicRepository } from '../ports/index.ts';

export interface CreateTopicInput {
  appId: AppId;
  key: string;
  name: string;
  /** CHỈ admin đặt được (ADR-0016 D6): app tự đặt mandatory là lách được opt-out. */
  mandatory?: boolean | undefined;
  defaultMode?: TopicDefaultMode | undefined;
}

/** Tạo topic ở `draft` — app service chưa thấy, chưa gửi được cho tới khi admin kích hoạt. */
export class CreateTopic {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; topics: TopicRepository; apps: AppLookup };

  constructor(deps: CreateTopic['deps']) {
    this.deps = deps;
  }

  async execute(input: CreateTopicInput, ctx: CommandContext): Promise<TopicDto> {
    const { uow, outbox, clock, topics, apps } = this.deps;
    return uow.run(async () => {
      if (!(await apps.exists(input.appId))) throw new NotFoundError('app', input.appId);
      const topic = new Topic({
        id: TopicId.create(),
        appId: input.appId,
        key: input.key,
        name: input.name,
        mandatory: input.mandatory,
        defaultMode: input.defaultMode,
        defaultChannels: ['email'], // MVP chỉ email (ADR-0016 D1)
        createdAt: clock.now(),
      });
      await topics.insert(topic);
      await outbox.append([
        {
          aggregateType: TOPIC_AGGREGATE,
          aggregateId: topic.id,
          eventType: TOPIC_EVENTS.created,
          payload: audited(ctx, {
            after: { appId: topic.appId, key: topic.key, mandatory: topic.mandatory, defaultMode: topic.defaultMode },
          }),
        },
      ]);
      return toTopicDto(topic);
    });
  }
}
