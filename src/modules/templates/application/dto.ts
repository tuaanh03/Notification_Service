import type { TemplateVersion } from '../domain/entities/template-version.ts';
import type { Template } from '../domain/entities/template.ts';
import type { VariableSpec } from '../domain/types/template-variable.ts';

/** Một dòng của màn danh sách template. */
export interface TemplateSummaryDto {
  /** `template_id` — thứ app service gửi kèm (`templateId`) để dùng template này. */
  id: string;
  name: string;
  channel: string;
  status: string;
  /** Số version đang được dùng để gửi; null = chưa từng xuất bản. */
  publishedVersion: number | null;
  publishedAt: string | null;
  /** Số version của bản nháp đang có; null = không có nháp. */
  draftVersion: number | null;
  /** Số biến của bản đang xuất bản (không có thì của bản nháp). */
  variableCount: number;
  createdAt: string;
  /** Lần sửa gần nhất của template HOẶC version của nó. */
  updatedAt: string;
}

export interface TemplateVersionDto {
  id: string;
  version: number;
  status: string;
  subject: string;
  html: string;
  text: string;
  variables: VariableSpec[];
  aiGenerated: boolean;
  createdBy: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetailDto extends TemplateSummaryDto {
  /** Mới nhất trước. */
  versions: TemplateVersionDto[];
}

export const toTemplateVersionDto = (v: TemplateVersion): TemplateVersionDto => ({
  id: v.id,
  version: v.version,
  status: v.status,
  subject: v.subject,
  html: v.html,
  text: v.text,
  variables: [...v.schema],
  aiGenerated: v.aiGenerated,
  createdBy: v.createdBy,
  publishedBy: v.publishedBy,
  publishedAt: v.publishedAt?.toISOString() ?? null,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
});

/** `versions` chỉ cần chứa draft + published (màn danh sách) hoặc đủ mọi version (chi tiết). */
export function toTemplateSummaryDto(t: Template, versions: readonly TemplateVersion[]): TemplateSummaryDto {
  const published = versions.find((v) => v.status === 'published') ?? null;
  const draft = versions.find((v) => v.status === 'draft') ?? null;
  const updatedAt = [t.updatedAt, ...versions.map((v) => v.updatedAt)].reduce((a, b) => (b > a ? b : a));
  return {
    id: t.id,
    name: t.name,
    channel: t.channel,
    status: t.status,
    publishedVersion: published?.version ?? null,
    publishedAt: published?.publishedAt?.toISOString() ?? null,
    draftVersion: draft?.version ?? null,
    variableCount: (published ?? draft)?.schema.length ?? 0,
    createdAt: t.createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export function toTemplateDetailDto(t: Template, versions: readonly TemplateVersion[]): TemplateDetailDto {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  return { ...toTemplateSummaryDto(t, sorted), versions: sorted.map(toTemplateVersionDto) };
}
