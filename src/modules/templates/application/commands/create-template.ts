import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  NotFoundError,
  TemplateId,
  TemplateVersionId,
  type AppId,
  type Clock,
  type TemplateCategory,
  type TemplateEditor,
} from '../../../../shared/kernel/index.ts';
import { TemplateVersion, type TemplateContent } from '../../domain/entities/template-version.ts';
import { Template } from '../../domain/entities/template.ts';
import { draftContent, emptyDesign } from '../../domain/rules/email-design.ts';
import type { EmailDesign } from '../../domain/types/email-design.ts';
import type { PresetLocale } from '../../domain/types/template-preset.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { AppLookup, TemplateRepository } from '../ports/index.ts';

export interface CreateTemplateInput {
  appId: AppId;
  name: string;
  /** Bỏ trống = `other`. */
  category?: TemplateCategory | undefined;
  /** Kiểu soạn của nháp v1 (ADR-0034); bỏ trống = `html`. */
  editor?: TemplateEditor | undefined;
  /** Chỉ với `blocks`; bỏ trống = thiết kế rỗng. */
  design?: EmailDesign | undefined;
  /** Nội dung ban đầu của nháp v1; bỏ trống = nháp rỗng, soạn sau bằng `SaveDraft`. `html` / `text` chỉ với kiểu `html`. */
  content?: { [K in 'subject' | 'html' | 'text' | 'schema']?: TemplateContent[K] | undefined } | undefined;
  /** Tạo từ thư viện mẫu (ADR-0035) — chỉ ghi vào audit, không có cột riêng. */
  createdFromPreset?: { presetId: string; presetVersion: number; locale: PresetLocale } | undefined;
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
    const c = input.content;
    const content = draftContent(
      input.editor === 'blocks'
        ? { editor: 'blocks', subject: c?.subject ?? '', design: input.design ?? emptyDesign(), schema: c?.schema ?? [] }
        : { editor: 'html', subject: c?.subject ?? '', html: c?.html ?? '', text: c?.text ?? '', schema: c?.schema ?? [] },
    );
    return uow.run(async () => {
      if (!(await apps.exists(input.appId))) throw new NotFoundError('app', input.appId);
      const now = clock.now();
      const template = new Template({
        id: TemplateId.create(),
        appId: input.appId,
        name: input.name,
        category: input.category,
        channel: 'email', // MVP chỉ email (ADR-0016 D1)
        createdAt: now,
      });
      const draft = new TemplateVersion({
        id: TemplateVersionId.create(),
        templateId: template.id,
        version: 1,
        ...content,
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
              editor: draft.editor,
              ...(input.createdFromPreset ? { createdFromPreset: input.createdFromPreset } : {}),
            },
          }),
        },
      ]);
      return toTemplateDetailDto(template, [draft]);
    });
  }
}
