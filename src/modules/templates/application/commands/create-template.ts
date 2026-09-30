import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, TemplateId, TemplateVersionId, type AppId, type Clock } from '../../../../shared/kernel/index.ts';
import { TemplateVersion, type TemplateContent } from '../../domain/entities/template-version.ts';
import { Template } from '../../domain/entities/template.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { AppLookup, TemplateRepository } from '../ports/index.ts';

export interface CreateTemplateInput {
  appId: AppId;
  name: string;
  /** Nội dung ban đầu của nháp v1; bỏ trống = nháp rỗng, soạn sau bằng `SaveDraft`. */
  content?: { [K in keyof TemplateContent]?: TemplateContent[K] | undefined } | undefined;
}

/** Tạo template kèm nháp v1. App chưa gửi được cho tới khi admin xuất bản. */
export class CreateTemplate {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    templates: TemplateRepository;
    apps: AppLookup;
  };

  constructor(deps: CreateTemplate['deps']) {
    this.deps = deps;
  }

  async execute(input: CreateTemplateInput, ctx: CommandContext): Promise<TemplateDetailDto> {
    const { uow, outbox, clock, templates, apps } = this.deps;
    return uow.run(async () => {
      if (!(await apps.exists(input.appId))) throw new NotFoundError('app', input.appId);
      const now = clock.now();
      const template = new Template({
        id: TemplateId.create(),
        appId: input.appId,
        name: input.name,
        channel: 'email', // MVP chỉ email (ADR-0016 D1)
        createdAt: now,
      });
      const draft = new TemplateVersion({
        id: TemplateVersionId.create(),
        templateId: template.id,
        version: 1,
        subject: input.content?.subject ?? '',
        html: input.content?.html ?? '',
        text: input.content?.text ?? '',
        schema: input.content?.schema ?? [],
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
          payload: audited(ctx, { after: { appId: template.appId, name: template.name, draftVersion: draft.version } }),
        },
      ]);
      return toTemplateDetailDto(template, [draft]);
    });
  }
}
