import { NotFoundError, type AppId, type TemplateId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, toTemplateSummaryDto, type TemplateDetailDto, type TemplateSummaryDto } from '../dto.ts';
import type { TemplateRepository } from '../ports/index.ts';

export class TemplateQueries {
  private readonly templates: TemplateRepository;

  constructor(deps: { templates: TemplateRepository }) {
    this.templates = deps.templates;
  }

  /** Màn danh sách: 2 truy vấn cho cả trang (template + draft/published của chúng), không N+1. */
  async list(appId: AppId): Promise<TemplateSummaryDto[]> {
    const templates = await this.templates.listByApp(appId);
    const versions = await this.templates.currentVersionsOf(templates.map((t) => t.id));
    return templates.map((t) =>
      toTemplateSummaryDto(
        t,
        versions.filter((v) => v.templateId === t.id),
      ),
    );
  }

  /** Template của app khác -> 404, như không tồn tại. */
  async get(appId: AppId, id: TemplateId): Promise<TemplateDetailDto> {
    const template = await this.templates.findById(appId, id);
    if (!template) throw new NotFoundError('template', id);
    return toTemplateDetailDto(template, await this.templates.versionsOf(template.id));
  }
}
