import { NotFoundError, type AppId, type TemplateId, type TemplateVersionId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, toTemplateSummaryDto, type TemplateDetailDto, type TemplateSummaryDto } from '../dto.ts';
import type { TemplateRepository, TemplateVersionLabel } from '../ports/index.ts';

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

  /** Cho module khác (lịch sử gửi): `template_version_id` -> tên + số version, MỘT truy vấn. */
  async labelsOf(versionIds: readonly TemplateVersionId[]): Promise<TemplateVersionLabel[]> {
    if (versionIds.length === 0) return [];
    return this.templates.labelsOfVersions([...new Set(versionIds)]);
  }
}
