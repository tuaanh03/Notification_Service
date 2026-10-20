import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { TemplateId, TemplateVersionId, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { TemplateVersion } from '../../domain/entities/template-version.ts';
import { Template } from '../../domain/entities/template.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate } from './lock-template.ts';

/**
 * Nhân bản trong CÙNG app (ADR-0033): template mới, id mới, chỉ có nháp v1 chép từ bản mới nhất của
 * bản gốc — nháp nếu có, không thì bản đang xuất bản. Chép một lần, không nối hai bên với nhau; app
 * chưa gửi được bằng bản sao cho tới khi admin xuất bản nó.
 *
 * Tên do người gọi đặt (bắt buộc): backend không tự ghép hậu tố như "(bản sao)" — chữ đó theo ngôn ngữ
 * của người soạn, console biết, backend thì không.
 *
 * Bản gốc đã lưu trữ vẫn nhân bản được: bản gốc giữ nguyên `archived`, đây không phải đường bỏ lưu trữ.
 */
export class DuplicateTemplate {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: DuplicateTemplate['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; templateId: TemplateId; name: string },
    ctx: CommandContext,
  ): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      // Khoá bản gốc: người khác đang lưu nháp / xuất bản thì chờ họ xong rồi mới chép.
      const source = await lockTemplate(templates, input.appId, input.templateId);
      const versions = await templates.versionsOf(source.id);
      const from = versions.find((v) => v.status === 'draft') ?? versions.find((v) => v.status === 'published');
      const now = clock.now();
      const template = new Template({
        id: TemplateId.create(),
        appId: source.appId,
        name: input.name,
        category: source.category,
        channel: source.channel,
        createdAt: now,
      });
      const draft = new TemplateVersion({
        id: TemplateVersionId.create(),
        templateId: template.id,
        version: 1,
        ...(from?.content ?? { editor: 'html', design: null, subject: '', html: '', text: '', schema: [] }),
        createdBy: ctx.actor.id,
        createdAt: now,
      });
      await templates.insert(template);
      await templates.insertVersion(draft);
      await outbox.append([
        {
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.created,
          payload: audited(ctx, {
            after: {
              appId: template.appId,
              name: template.name,
              category: template.category,
              draftVersion: draft.version,
              duplicatedFrom: { templateId: source.id, version: from?.version ?? null },
            },
          }),
        },
      ]);
      return toTemplateDetailDto(template, [draft]);
    });
  }
}
