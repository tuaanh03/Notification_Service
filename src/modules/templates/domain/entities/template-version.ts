import {
  BaseEntity,
  ValidationError,
  type Issue,
  type TemplateId,
  type TemplateVersionId,
  type TemplateVersionStatus,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';
import { validateBody } from '../rules/template-variables.ts';
import type { VariableSpec } from '../types/template-variable.ts';

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
  publishedAt?: Date | null | undefined;
}

/**
 * Nội dung chỉ đông cứng ở version. Mỗi template có TỐI ĐA MỘT version `published`
 * tại một thời điểm — MySQL không có partial unique index nên ràng buộc này được ép
 * bằng generated column + unique index (xem schema.ts).
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
    this.publishedAt = props.publishedAt ?? null;
  }

  /** Trả về danh sách lỗi; rỗng = publish được. AI sinh ra cũng đi qua đúng cửa này. */
  validate(): Issue[] {
    return [
      ...validateBody(this.subject, this.schema),
      ...validateBody(this.html, this.schema),
      ...validateBody(this.text, this.schema),
    ];
  }

  publish(at: Date): void {
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
    this.touch(at);
  }

  supersede(at: Date): void {
    this.status = 'superseded';
    this.touch(at);
  }
}
