import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { ConflictError, type AppId, type Clock, type TemplateId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate } from './lock-template.ts';

/**
 * Xuất bản bản nháp: kiểm tra đầy đủ (lỗi -> 422 kèm danh sách), bản đang xuất bản chuyển sang
 * `superseded`, nháp thành bản chính thức — cùng một transaction. Từ lần gửi kế tiếp, app dùng bản mới.
 *
 * Hai admin cùng bấm: người sau chờ khoá, đọc lại thì nháp đã thành published -> 409 `NO_DRAFT`.
 */
export class PublishVersion {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: PublishVersion['deps']) {
    this.deps = deps;
  }

  async execute(input: { appId: AppId; templateId: TemplateId }, ctx: CommandContext): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      const template = await lockTemplate(templates, input.appId, input.templateId);
      template.assertActive();
      const versions = await templates.versionsOf(template.id);
      const draft = versions.find((v) => v.status === 'draft');
      if (!draft) throw new ConflictError('NO_DRAFT', 'template has no draft to publish');
      const current = versions.find((v) => v.status === 'published') ?? null;

      const now = clock.now();
      draft.publish(now, ctx.actor.id); // kiểm tra TRƯỚC khi đụng bản đang xuất bản
      if (current) {
        // Hạ bản cũ trước: unique `uq_template_versions_one_published` không cho hai bản published cùng lúc.
        current.supersede(now);
        await templates.updateVersion(current, 'published');
      }
      await templates.updateVersion(draft, 'draft');
      await outbox.append([
        {
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.versionPublished,
          payload: audited(ctx, {
            before: { publishedVersion: current?.version ?? null },
            after: { publishedVersion: draft.version },
          }),
        },
      ]);
      return toTemplateDetailDto(template, versions);
    });
  }
}
