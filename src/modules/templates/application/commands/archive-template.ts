import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AppId, Clock, TemplateId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate } from './lock-template.ts';

/** Lưu trữ template: không sửa, không xuất bản, không gửi được nữa. Version giữ nguyên để tra lịch sử. */
export class ArchiveTemplate {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: ArchiveTemplate['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; templateId: TemplateId }, ctx: CommandContext): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      const template = await lockTemplate(templates, input.appId, input.templateId);
      const before = template.status;
      template.archive(clock.now());
      if (template.status !== before) {
        await templates.update(template);
        await outbox.append([
          {
            aggregateType: TEMPLATE_AGGREGATE,
            aggregateId: template.id,
            eventType: TEMPLATE_EVENTS.archived,
            payload: audited(ctx, { before: { status: before }, after: { status: template.status } }),
          },
        ]);
      }
      return toTemplateDetailDto(template, await templates.versionsOf(template.id));
    });
  }
}
