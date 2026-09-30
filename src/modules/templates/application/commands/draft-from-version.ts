import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  ConflictError,
  NotFoundError,
  TemplateVersionId,
  type AppId,
  type Clock,
  type TemplateId,
} from '../../../../shared/kernel/index.ts';
import { TemplateVersion } from '../../domain/entities/template-version.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { TemplateRepository } from '../ports/index.ts';
import { lockTemplate, nextVersionNumber } from './lock-template.ts';

/**
 * Tạo nháp mới chép nội dung của một version có sẵn — "Sửa bản đang xuất bản" và "Quay về bản cũ"
 * đều là việc này. Bản cũ giữ nguyên (lịch sử gửi trỏ tới nó); đã có nháp thì 409 `DRAFT_EXISTS`.
 */
export class DraftFromVersion {
  private readonly deps: { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; templates: TemplateRepository };

  constructor(deps: DraftFromVersion['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { appId: AppId; templateId: TemplateId; version: number },
    ctx: CommandContext,
  ): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates } = this.deps;
    return uow.run(async () => {
      const template = await lockTemplate(templates, input.appId, input.templateId);
      template.assertActive();
      const versions = await templates.versionsOf(template.id);
      const existing = versions.find((v) => v.status === 'draft');
      if (existing) {
        throw new ConflictError('DRAFT_EXISTS', `template already has draft version ${existing.version}`);
      }
      const source = versions.find((v) => v.version === input.version);
      if (!source) throw new NotFoundError('template version', String(input.version));

      const draft = new TemplateVersion({
        id: TemplateVersionId.create(),
        templateId: template.id,
        version: nextVersionNumber(versions),
        ...source.content,
        createdBy: ctx.actor.id,
        createdAt: clock.now(),
      });
      await templates.insertVersion(draft);
      await outbox.append([
        {
          aggregateType: TEMPLATE_AGGREGATE,
          aggregateId: template.id,
          eventType: TEMPLATE_EVENTS.draftSaved,
          payload: audited(ctx, { after: { draftVersion: draft.version, copiedFromVersion: source.version } }),
        },
      ]);
      return toTemplateDetailDto(template, [...versions, draft]);
    });
  }
}
