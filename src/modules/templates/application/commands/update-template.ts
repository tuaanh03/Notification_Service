import {
  audited,
  type CommandContext,
  type EventOutbox,
  type IntegrationEvent,
  type UnitOfWork,
} from '../../../../shared/application/index.ts';
import type { AppId, Clock, TemplateCategory, TemplateId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate } from './lock-template.ts';

/**
 * Đổi tên và / hoặc nhóm trong MỘT transaction — app gửi bằng id nên cả hai không ảnh hưởng việc gửi.
 * Mỗi thứ thật sự đổi ghi một event riêng; không đổi gì thì không ghi.
 */
export class UpdateTemplate {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: UpdateTemplate['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; templateId: TemplateId; name?: string | undefined; category?: TemplateCategory | undefined },
    ctx: CommandContext,
  ): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      const template = await lockTemplate(templates, input.appId, input.templateId);
      const before = { name: template.name, category: template.category };
      const now = clock.now();
      if (input.name !== undefined) template.rename(input.name, now);
      if (input.category !== undefined) template.changeCategory(input.category, now);

      const events: IntegrationEvent[] = [];
      if (template.name !== before.name) {
        events.push({
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.renamed,
          payload: audited(ctx, { before: { name: before.name }, after: { name: template.name } }),
        });
      }
      if (template.category !== before.category) {
        events.push({
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.categoryChanged,
          payload: audited(ctx, { before: { category: before.category }, after: { category: template.category } }),
        });
      }
      if (events.length) {
        await templates.update(template);
        await outbox.append(events);
      }
      return toTemplateDetailDto(template, await templates.versionsOf(template.id));
    });
  }
}
