import {
  BaseEntity,
  ConflictError,
  ValidationError,
  issue,
  type Issue,
  type TemplateId,
  type TemplateVersionId,
  type TemplateVersionStatus,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';
import { validateBody, validateLinks, validateSchema, validateSupportedVariables } from '../rules/template-variables.ts';
import type { VariableSpec } from '../types/template-variable.ts';

/** Nội dung soạn được của một version — đúng thứ `PUT .../draft` ghi. */
export interface TemplateContent {
  subject: string;
  html: string;
  text: string;
  schema: readonly VariableSpec[];
}

export interface TemplateVersionProps extends TimestampInput {
  id: TemplateVersionId;
  templateId: TemplateId;
  version: number;
  status?: TemplateVersionStatus | undefined;
  subject: string;
  html: string;
  text: string;
  schema?: readonly VariableSpec[] | undefined;
  aiGenerated?: boolean | undefined;
  /** ID admin tạo bản này; null với dữ liệu có trước migration 0006. */
  createdBy?: string | null | undefined;
  publishedBy?: string | null | undefined;
  publishedAt?: Date | null | undefined;
}

/**
 * Nội dung chỉ đông cứng ở version. Mỗi template có TỐI ĐA MỘT version `published`
 * tại một thời điểm — MySQL không có partial unique index nên ràng buộc này được ép
 * bằng generated column + unique index (xem schema.ts). "Tối đa một draft" thì không
 * ép được ở DB — command khoá dòng `templates` rồi mới tìm draft (ADR-0009).
 *
 * Nháp được lưu cả khi còn lỗi (người soạn lưu dở); mọi kiểm tra chạy ở `publish`.
 */
export class TemplateVersion extends BaseEntity<TemplateVersionId> {
  readonly templateId: TemplateId;
  readonly version: number;
  status: TemplateVersionStatus;
  subject: string;
  html: string;
  text: string;
  schema: readonly VariableSpec[];
  readonly aiGenerated: boolean;
  readonly createdBy: string | null;
  publishedBy: string | null;
  publishedAt: Date | null;

  constructor(props: TemplateVersionProps) {
    super(props.id, props);
    this.templateId = props.templateId;
    this.version = props.version;
    this.status = props.status ?? 'draft';
    this.subject = props.subject;
    this.html = props.html;
    this.text = props.text;
    this.schema = props.schema ?? [];
    this.aiGenerated = props.aiGenerated ?? false;
    this.createdBy = props.createdBy ?? null;
    this.publishedBy = props.publishedBy ?? null;
    this.publishedAt = props.publishedAt ?? null;
  }

  get content(): TemplateContent {
    return { subject: this.subject, html: this.html, text: this.text, schema: this.schema };
  }

  /** Chỉ bản nháp sửa được — bản đã xuất bản là thứ đang gửi đi, sửa tại chỗ là đổi thư giữa chừng. */
  edit(content: TemplateContent, at: Date): void {
    if (this.status !== 'draft') {
      throw new ConflictError('VERSION_NOT_DRAFT', `version ${this.version} is ${this.status}, only a draft can be edited`);
    }
    this.subject = content.subject;
    this.html = content.html;
    this.text = content.text;
    this.schema = content.schema;
    this.touch(at);
  }

  /** Trả về danh sách lỗi; rỗng = publish được. AI sinh ra cũng đi qua đúng cửa này. */
  validate(): Issue[] {
    const issues: Issue[] = [];
    if (!this.subject.trim()) issues.push(issue('SUBJECT_REQUIRED', 'subject must not be empty', 'subject'));
    if (!this.html.trim()) issues.push(issue('HTML_REQUIRED', 'html must not be empty', 'html'));
    const all = [
      ...issues,
      ...validateSchema(this.schema),
      ...[this.subject, this.html, this.text].flatMap((body) => [
        ...validateBody(body, this.schema),
        ...validateSupportedVariables(body),
      ]),
      ...validateLinks(this.html),
    ];
    // Một biến sai dùng ở cả subject lẫn html chỉ cần báo một lần.
    const seen = new Set<string>();
    return all.filter((i) => {
      const key = `${i.code}|${i.path ?? ''}|${i.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  publish(at: Date, by: string): void {
    if (this.status === 'published') return;
    if (this.status === 'superseded') {
      throw ValidationError.of(
        'VERSION_SUPERSEDED',
        'version is superseded, create a new version instead of republishing',
      );
    }
    const issues = this.validate();
    if (issues.length) throw new ValidationError(issues);
    this.status = 'published';
    this.publishedAt = at;
    this.publishedBy = by;
    this.touch(at);
  }

  supersede(at: Date): void {
    this.status = 'superseded';
    this.touch(at);
  }
}
