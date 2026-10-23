import { NotFoundError, type AppId, type TemplateId, type TemplateVersionId } from '../../../../shared/kernel/index.ts';
import { toTemplateDetailDto, toTemplateSummaryDto, type TemplateDetailDto, type TemplateSummaryDto } from '../dto.ts';
import type { TemplateListFilter, TemplateRepository, TemplateVersionLabel } from '../ports/index.ts';

export class TemplateQueries {
  private readonly templates: TemplateRepository;

  constructor(deps: { templates: TemplateRepository }) {
    this.templates = deps.templates;
  }

  /** Màn danh sách: 2 truy vấn cho cả trang (template + draft/published của chúng), không N+1. */
  async list(appId: AppId, filter: TemplateListFilter = {}): Promise<TemplateSummaryDto[]> {
    const templates = await this.templates.listByApp(appId, filter);
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

  /**
   * Cho module khác (incoming webhook — ADR-0030): biến của bản ĐANG XUẤT BẢN, để biết rút biến nào từ JSON
   * gửi tới. Template của app khác -> null, như không tồn tại. Chưa xuất bản / đã lưu trữ -> `variables` rỗng
   * kèm `status` để nơi gọi cảnh báo.
   */
  async publishedVariables(
    appId: AppId,
    id: TemplateId,
  ): Promise<{
    templateId: TemplateId;
    name: string;
    status: 'published' | 'unpublished' | 'archived';
    version: number | null;
    variables: { name: string; required: boolean }[];
  } | null> {
    const template = await this.templates.findById(appId, id);
    if (!template) return null;
    const version = template.status === 'archived' ? null : await this.templates.findPublishedVersion(template.id);
    return {
      templateId: template.id,
      name: template.name,
      status: template.status === 'archived' ? 'archived' : version ? 'published' : 'unpublished',
      version: version?.version ?? null,
      variables: version ? version.schema.map((v) => ({ name: v.name, required: v.required })) : [],
    };
  }

  /**
   * Cho module khác (số liệu template — UX-24): mọi version của template, mới nhất trước, chỉ số + ngày
   * xuất bản (không kèm nội dung). Template của app khác -> null, như không tồn tại.
   */
  async versionMarks(
    appId: AppId,
    id: TemplateId,
  ): Promise<{ templateVersionId: TemplateVersionId; version: number; publishedAt: Date | null }[] | null> {
    const template = await this.templates.findById(appId, id);
    if (!template) return null;
    return (await this.templates.versionsOf(template.id))
      .sort((a, b) => b.version - a.version)
      .map((v) => ({ templateVersionId: v.id, version: v.version, publishedAt: v.publishedAt }));
  }

  /** Cho module khác (lịch sử gửi): `template_version_id` -> tên + số version, MỘT truy vấn. */
  async labelsOf(versionIds: readonly TemplateVersionId[]): Promise<TemplateVersionLabel[]> {
    if (versionIds.length === 0) return [];
    return this.templates.labelsOfVersions([...new Set(versionIds)]);
  }
}
