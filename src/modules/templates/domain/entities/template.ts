import {
  BaseEntity,
  ConflictError,
  ValidationError,
  type AppId,
  type Channel,
  type TemplateId,
  type TemplateStatus,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';

export const TEMPLATE_NAME_MAX_LENGTH = 200;

export interface TemplateProps extends TimestampInput {
  id: TemplateId;
  appId: AppId;
  name: string;
  channel: Channel;
  status?: TemplateStatus | undefined;
}

/**
 * Template chỉ là cái vỏ: định danh (`id` — app gửi bằng id này, ADR-0020) + tên cho người đọc.
 * Nội dung nằm ở `TemplateVersion`. Tên không trùng trong một app — ép bằng unique index.
 */
export class Template extends BaseEntity<TemplateId> {
  readonly appId: AppId;
  readonly channel: Channel;
  name: string;
  status: TemplateStatus;

  constructor(props: TemplateProps) {
    super(props.id, props);
    this.appId = props.appId;
    this.name = normalizeName(props.name);
    this.channel = props.channel;
    this.status = props.status ?? 'active';
  }

  rename(name: string, at: Date): void {
    this.assertActive();
    this.name = normalizeName(name);
    this.touch(at);
  }

  /** Lưu trữ: không sửa, không xuất bản, không gửi được nữa. Gọi lại khi đã lưu trữ thì không làm gì. */
  archive(at: Date): void {
    if (this.status === 'archived') return;
    this.status = 'archived';
    this.touch(at);
  }

  /** Mọi thay đổi nội dung (nháp, xuất bản, đổi tên) chỉ làm được khi template còn `active`. */
  assertActive(): void {
    if (this.status === 'archived') {
      throw new ConflictError('TEMPLATE_ARCHIVED', `template ${this.id} is archived`);
    }
  }
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (!name) throw ValidationError.of('TEMPLATE_NAME_REQUIRED', 'template name must not be empty', 'name');
  if (name.length > TEMPLATE_NAME_MAX_LENGTH) {
    throw ValidationError.of(
      'TEMPLATE_NAME_TOO_LONG',
      `template name must be at most ${TEMPLATE_NAME_MAX_LENGTH} characters`,
      'name',
    );
  }
  return name;
}
