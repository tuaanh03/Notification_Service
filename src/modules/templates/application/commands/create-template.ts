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
import { draftContent, type DraftInput } from '../../domain/rules/email-design.ts';
import { emptyVisualDesign, type VisualDesign } from '../../domain/types/visual-design.ts';
import type { PresetLocale } from '../../domain/types/template-preset.ts';
import { toTemplateDetailDto, type TemplateDetailDto } from '../dto.ts';
import { TEMPLATE_AGGREGATE, TEMPLATE_EVENTS } from '../events.ts';
import type { AppLookup, TemplateRepository } from '../ports/index.ts';

export interface CreateTemplateInput {
  appId: AppId;
  name: string;
  /** Bỏ trống = `other`. */
  category?: TemplateCategory | undefined;
  /** Kiểu soạn của nháp v1 (ADR-0036); bỏ trống = `html`. */
  editor?: TemplateEditor | undefined;
  /** Chỉ kiểu `visual`; bỏ trống = thư trống (console dựng thư mở đầu). */
  design?: VisualDesign | undefined;
  /**
   * Nội dung ban đầu của nháp v1; bỏ trống = nháp rỗng, soạn sau bằng `SaveDraft`. `html` với kiểu `html` /
   * `visual`, `text` chỉ với kiểu `html`.
   */
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
    const content = draftContent(draftOf(input));
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

function draftOf(input: CreateTemplateInput): DraftInput {
  const c = input.content;
  const subject = c?.subject ?? '';
  const schema = c?.schema ?? [];
  return input.editor === 'visual'
    ? { editor: 'visual', subject, html: c?.html ?? '', design: input.design ?? emptyVisualDesign(), schema }
    : { editor: 'html', subject, html: c?.html ?? '', text: c?.text ?? '', schema };
}
