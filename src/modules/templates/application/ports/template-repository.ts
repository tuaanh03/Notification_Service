import type { AppId, TemplateId, TemplateVersionStatus } from '../../../../shared/kernel/index.ts';
import type { TemplateVersion } from '../../domain/entities/template-version.ts';
import type { Template } from '../../domain/entities/template.ts';

/** Template + các version của nó — một aggregate, một repository. */
export interface TemplateRepository {
  /**
   * `SELECT ... FOR UPDATE` dòng `templates` của ĐÚNG app — mọi lệnh ghi gọi trước khi đọc version
   * (ADR-0009: "tối đa 1 draft", "đổi published" không ép được bằng index). false = không có.
   */
  lockForUpdate(appId: AppId, id: TemplateId): Promise<boolean>;
  /** Template của app khác coi như không có — không lộ id của app khác. */
  findById(appId: AppId, id: TemplateId): Promise<Template | null>;
  listByApp(appId: AppId): Promise<Template[]>;
  /** Trùng tên trong app -> ConflictError `TEMPLATE_NAME_TAKEN`. */
  insert(template: Template): Promise<void>;
  /** Ghi tên + trạng thái; trùng tên -> ConflictError `TEMPLATE_NAME_TAKEN`. */
  update(template: Template): Promise<void>;

  /** Mọi version của một template, version mới nhất trước. */
  versionsOf(templateId: TemplateId): Promise<TemplateVersion[]>;
  /** Draft + published của nhiều template trong MỘT truy vấn — màn danh sách không bắn N+1. */
  currentVersionsOf(templateIds: readonly TemplateId[]): Promise<TemplateVersion[]>;
  insertVersion(version: TemplateVersion): Promise<void>;
  /** Ghi có điều kiện theo trạng thái lúc đọc -> ConcurrentTransitionError (409) nếu bên kia đổi trước. */
  updateVersion(version: TemplateVersion, expectedStatus: TemplateVersionStatus): Promise<void>;
}
