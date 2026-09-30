import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { TemplateVersionId, type AppId, type Clock, type TemplateId } from '../../../../shared/kernel/index.ts';
import { TemplateVersion, type TemplateContent } from '../../domain/entities/template-version.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate, nextVersionNumber } from './lock-template.ts';

/**
 * Ghi bản nháp: có nháp thì ghi đè, chưa có thì tạo nháp số kế tiếp. Mỗi template TỐI ĐA MỘT nháp —
 * ép ở đây, sau khi khoá dòng cha. Nháp được lưu cả khi còn lỗi; kiểm tra đầy đủ chạy lúc xuất bản.
 */
export class SaveDraft {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: SaveDraft['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; templateId: TemplateId; content: TemplateContent },
    ctx: CommandContext,
  ): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      const template = await lockTemplate(templates, input.appId, input.templateId);
      template.assertActive();
      const now = clock.now();
      const versions = await templates.versionsOf(template.id);
      let draft = versions.find((v) => v.status === 'draft');
      if (draft) {
        draft.edit(input.content, now);
        await templates.updateVersion(draft, 'draft');
      } else {
        draft = new TemplateVersion({
          id: TemplateVersionId.create(),
          templateId: template.id,
          version: nextVersionNumber(versions),
          ...input.content,
          createdBy: ctx.actor.id,
          createdAt: now,
        });
        await templates.insertVersion(draft);
        versions.push(draft);
      }
      // Không đưa subject / html vào audit: nội dung có thể lớn và audit chỉ cần "ai sửa bản nào".
      await outbox.append([
        {
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.draftSaved,
          payload: audited(ctx, { after: { draftVersion: draft.version } }),
        },
      ]);
      return toTemplateDetailDto(template, versions);
    });
  }
}
