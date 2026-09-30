import { NotFoundError, type AppId, type TemplateId } from '../../../../shared/kernel/index.ts';
import type { Template } from '../../domain/entities/template.ts';
import type { TemplateRepository } from '../ports/index.ts';

/**
 * Bước đầu của MỌI lệnh ghi: khoá dòng `templates` rồi mới đọc (ADR-0009, READ COMMITTED — ADR-0017).
 * Hai admin cùng xuất bản / cùng tạo nháp thì người sau chờ người trước commit, rồi đọc lại trạng thái mới.
 * Phải gọi trong `uow.run`.
 */
export async function lockTemplate(templates: TemplateRepository, appId: AppId, id: TemplateId): Promise<Template> {
  const template = (await templates.lockForUpdate(appId, id)) ? await templates.findById(appId, id) : null;
  if (!template) throw new NotFoundError('template', id);
  return template;
}

/** Số cho version mới: lớn nhất hiện có + 1. An toàn vì đã khoá dòng cha. */
export const nextVersionNumber = (versions: readonly { version: number }[]): number =>
  versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
