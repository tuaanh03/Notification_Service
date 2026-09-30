import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AppId, Clock, TemplateId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate } from './lock-template.ts';

/** Đổi tên — app gửi bằng id nên đổi tên không ảnh hưởng gì tới việc gửi. */
export class RenameTemplate {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: RenameTemplate['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; templateId: TemplateId; name: string },
    ctx: CommandContext,
  ): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      const template = await lockTemplate(templates, input.appId, input.templateId);
      const before = template.name;
      template.rename(input.name, clock.now());
      if (template.name !== before) {
        await templates.update(template);
        await outbox.append([
          {
            aggregateType: TEMPLATE_AGGREGATE,
            aggregateId: template.id,
            eventType: TEMPLATE_EVENTS.renamed,
            payload: audited(ctx, { before: { name: before }, after: { name: template.name } }),
          },
        ]);
      }
      return toTemplateDetailDto(template, await templates.versionsOf(template.id));
    });
  }
}
