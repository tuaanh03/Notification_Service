import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import type { TopicTransitionEvent } from '../../domain/rules/topic-transitions.ts';
import { toTopicDto, type TopicDto } from '../dto.ts';
import { TOPIC_AGGREGATE, TOPIC_EVENTS } from '../events.ts';
import type { TopicRepository } from '../ports/index.ts';

const EVENT_OF: Record<TopicTransitionEvent, string> = {
  activate: TOPIC_EVENTS.activated,
  suspend: TOPIC_EVENTS.suspended,
};

/** Kích hoạt / đình chỉ topic theo TOPIC_TRANSITIONS. Sai đường -> 409 INVALID_TRANSITION. */
export class TransitionTopic {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; topics: TopicRepository };

  constructor(deps: TransitionTopic['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; key: string; transition: TopicTransitionEvent },
    ctx: CommandContext,
  ): Promise<TopicDto> {
    const { uow, outbox, clock, topics } = this.deps;
    return uow.run(async () => {
      const topic = await topics.findByKey(input.appId, input.key);
      if (!topic) throw new NotFoundError('topic', input.key);
      const before = topic.status;
      topic.apply(input.transition, clock.now());
      await topics.update(topic, before);
      await outbox.append([
        {
          aggregateType: TOPIC_AGGREGATE,
          aggregateId: topic.id,
          eventType: EVENT_OF[input.transition],
          payload: audited(ctx, { before: { status: before }, after: { status: topic.status } }),
        },
      ]);
      return toTopicDto(topic);
    });
  }
}
