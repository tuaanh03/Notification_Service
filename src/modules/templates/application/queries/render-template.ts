import { ValidationError, type AppId, type TemplateId, type TemplateVersionId } from '../../../../shared/kernel/index.ts';
import { renderTemplate } from '../../domain/rules/render-template.ts';
import type { TemplateRepository } from '../ports/index.ts';

export interface RenderedTemplateDto {
  templateId: TemplateId;
  templateVersionId: TemplateVersionId;
  name: string;
  version: number;
  subject: string;
  html: string;
  text: string;
}

/**
 * Use case CÔNG KHAI cho module khác (notifications): đổ `payload` vào bản đang xuất bản của một
 * template, lúc API nhận request gửi (ADR-0020). Chỉ đọc, không ghi gì.
 *
 * Lỗi đều là 422 (như TOPIC_NOT_FOUND): request đúng đường, dữ liệu bên trong sai.
 * Template của app khác -> TEMPLATE_NOT_FOUND, như không tồn tại.
 */
export class RenderTemplate {
  private readonly templates: TemplateRepository;

  constructor(deps: { templates: TemplateRepository }) {
    this.templates = deps.templates;
  }

  async execute(input: {
    appId: AppId;
    templateId: TemplateId;
    payload: Readonly<Record<string, unknown>>;
    externalId: string;
  }): Promise<RenderedTemplateDto> {
    const template = await this.templates.findById(input.appId, input.templateId);
    if (!template) {
      throw ValidationError.of('TEMPLATE_NOT_FOUND', `template ${input.templateId} does not exist`, 'templateId');
    }
    if (template.status === 'archived') {
      throw ValidationError.of('TEMPLATE_ARCHIVED', `template ${input.templateId} is archived`, 'templateId');
    }
    const version = await this.templates.findPublishedVersion(template.id);
    if (!version) {
      throw ValidationError.of(
        'TEMPLATE_NOT_PUBLISHED',
        `template ${input.templateId} has no published version yet`,
        'templateId',
      );
    }
    const rendered = renderTemplate(version.content, { payload: input.payload, externalId: input.externalId });
    return {
      templateId: template.id,
      templateVersionId: version.id,
      name: template.name,
      version: version.version,
      ...rendered,
    };
  }
}
