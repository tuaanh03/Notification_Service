import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { toTopicDto, type TopicDto } from '../dto.ts';
import { TOPIC_AGGREGATE, TOPIC_EVENTS } from '../events.ts';
import type { TopicRepository } from '../ports/index.ts';

/**
 * Đặt / bỏ bắt buộc cho topic đã có. Người quản lý app tự quyết (`app.manage`), không cần lý do.
 *
 * Không xoá lựa chọn của người nhận: bỏ bắt buộc thì ai từng tắt quay về đúng lựa chọn cũ. Đặt đúng giá
 * trị đang có -> trả topic, không ghi gì (không event, không audit).
 */
export class SetTopicMandatory {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; topics: TopicRepository };

  constructor(deps: SetTopicMandatory['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; key: string; mandatory: boolean }, ctx: CommandContext): Promise<TopicDto> {
    const { uow, outbox, clock, topics } = this.deps;
    return uow.run(async () => {
      const topic = await topics.findByKey(input.appId, input.key);
      if (!topic) throw new NotFoundError('topic', input.key);
      if (topic.mandatory === input.mandatory) return toTopicDto(topic);
      const before = topic.mandatory;
      topic.setMandatory(input.mandatory, clock.now());
      await topics.update(topic, topic.status);
      await outbox.append([
        {
          aggregateType: TOPIC_AGGREGATE,
          aggregateId: topic.id,
          eventType: TOPIC_EVENTS.mandatoryChanged,
          payload: audited(ctx, { before: { key: topic.key, mandatory: before }, after: { key: topic.key, mandatory: topic.mandatory } }),
        },
      ]);
      return toTopicDto(topic);
    });
  }
}
