import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { ConflictError, type AppId, type Clock, type TemplateId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate } from './lock-template.ts';

/**
 * "Chuyển sang HTML" (ADR-0034): nháp kéo-thả thành nháp HTML, giữ `html` / `text` đã sinh, bỏ thiết kế.
 * Một chiều. Chỉ nháp đổi — bản đang xuất bản (nếu có) giữ nguyên kiểu soạn của nó.
 */
export class ConvertDraftToHtml {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: ConvertDraftToHtml['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; templateId: TemplateId }, ctx: CommandContext): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      const template = await lockTemplate(templates, input.appId, input.templateId);
      template.assertActive();
      const versions = await templates.versionsOf(template.id);
      const draft = versions.find((v) => v.status === 'draft');
      if (!draft) throw new ConflictError('NO_DRAFT', 'template has no draft to convert');
      draft.convertToHtml(clock.now());
      await templates.updateVersion(draft, 'draft');
      await outbox.append([
        {
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.draftSaved,
          payload: audited(ctx, { after: { draftVersion: draft.version, editor: 'html', convertedToHtml: true } }),
        },
      ]);
      return toTemplateDetailDto(template, versions);
    });
  }
}
