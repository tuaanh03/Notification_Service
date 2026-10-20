import type { AppId, TemplateCategory, TemplateEditor, TemplateId, TemplateVersionId, TemplateVersionStatus } from '../../../../shared/kernel/index.ts';
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
  /** Xếp theo tên. `search` khớp một phần tên, không phân biệt hoa thường và dấu (theo collation). */
  listByApp(appId: AppId, filter?: TemplateListFilter): Promise<Template[]>;
  /** Trùng tên trong app -> ConflictError `TEMPLATE_NAME_TAKEN`. */
  insert(template: Template): Promise<void>;
  /** Ghi tên + trạng thái; trùng tên -> ConflictError `TEMPLATE_NAME_TAKEN`. */
  update(template: Template): Promise<void>;

  /** Mọi version của một template, version mới nhất trước. */
  versionsOf(templateId: TemplateId): Promise<TemplateVersion[]>;
  /** Draft + published của nhiều template trong MỘT truy vấn — màn danh sách không bắn N+1. */
  currentVersionsOf(templateIds: readonly TemplateId[]): Promise<TemplateVersion[]>;
  /** Bản đang xuất bản — đường gửi đọc đúng một bản này. */
  findPublishedVersion(templateId: TemplateId): Promise<TemplateVersion | null>;
  /** Tên template + số version theo LÔ — lịch sử gửi chỉ lưu `template_version_id`. */
  labelsOfVersions(versionIds: readonly TemplateVersionId[]): Promise<TemplateVersionLabel[]>;
  /**
   * Mọi version (mọi app, mọi trạng thái) của một kiểu soạn, kèm template — CHỈ ĐỌC, cho lệnh chạy thử
   * của admin-cli (ADR-0036). Không dùng ở đường HTTP: không lọc theo app.
   */
  versionsByEditor(editor: TemplateEditor): Promise<{ template: Template; version: TemplateVersion }[]>;
  insertVersion(version: TemplateVersion): Promise<void>;
  /** Ghi có điều kiện theo trạng thái lúc đọc -> ConcurrentTransitionError (409) nếu bên kia đổi trước. */
  updateVersion(version: TemplateVersion, expectedStatus: TemplateVersionStatus): Promise<void>;
  /**
   * XOÁ HẲN template + mọi version của nó — CHỈ lệnh dọn kiểu kéo-thả của admin-cli (ADR-0037), trong `uow.run`.
   * Còn thư / lần phát / incoming hook trỏ tới thì khoá ngoại chặn (lệnh dọn kiểm trước khi gọi).
   */
  deleteWithVersions(templateId: TemplateId): Promise<void>;
}

export interface TemplateListFilter {
  category?: TemplateCategory | undefined;
  search?: string | undefined;
}

export interface TemplateVersionLabel {
  templateVersionId: TemplateVersionId;
  templateId: TemplateId;
  name: string;
  version: number;
}
