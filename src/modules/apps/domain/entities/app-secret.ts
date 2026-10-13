import {
  BaseEntity,
  ValidationError,
  type AppId,
  type AppSecretId,
  type AppSecretStatus,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';

/** Độ dài tối đa của tên khoá (cột `app_secrets.name`). */
export const SECRET_NAME_MAX_LENGTH = 100;

export interface AppSecretProps extends TimestampInput {
  id: AppSecretId;
  appId: AppId;
  /** argon2 hash. Plaintext KHÔNG BAO GIỜ được lưu — chỉ trả về đúng một lần lúc tạo. */
  secretHash: string;
  /** Đoạn nhận dạng hiển thị được, ví dụ `nsk_live_…a1b2`. */
  hint: string;
  /** Tên người cấp đặt để biết khoá dùng ở đâu, ví dụ "backend prod". Khoá cũ không có tên -> null. */
  name?: string | null | undefined;
  status?: AppSecretStatus | undefined;
  revokedAt?: Date | null | undefined;
  /** Lần cuối khoá xác thực thành công — cập nhật thưa (xem `AuthenticateApiKey`). */
  lastUsedAt?: Date | null | undefined;
}

export class AppSecret extends BaseEntity<AppSecretId> {
  readonly appId: AppId;
  readonly secretHash: string;
  readonly hint: string;
  readonly name: string | null;
  status: AppSecretStatus;
  revokedAt: Date | null;
  readonly lastUsedAt: Date | null;

  constructor(props: AppSecretProps) {
    super(props.id, props);
    if (!props.secretHash.trim()) throw ValidationError.of('SECRET_HASH_REQUIRED', 'secretHash must not be empty', 'secretHash');
    this.appId = props.appId;
    this.secretHash = props.secretHash;
    this.hint = props.hint;
    const name = props.name?.trim() ?? '';
    if (name.length > SECRET_NAME_MAX_LENGTH) {
      throw ValidationError.of('SECRET_NAME_TOO_LONG', `name must be at most ${SECRET_NAME_MAX_LENGTH} characters`, 'name');
    }
    this.name = name === '' ? null : name;
    this.status = props.status ?? 'active';
    this.revokedAt = props.revokedAt ?? null;
    this.lastUsedAt = props.lastUsedAt ?? null;
  }

  revoke(at: Date): void {
    if (this.status === 'revoked') return;
    this.status = 'revoked';
    this.revokedAt = at;
    this.touch(at);
  }

  /**
   * MySQL không có partial unique index nên ràng buộc "≤ N active" không ép được ở DB.
   * Command phải gọi hàm này trong cùng transaction với lần insert. Xem ADR-0009.
   * `max` là cài đặt hệ thống `apps.max_active_api_keys`.
   */
  static assertCanAddActive(currentActiveCount: number, max: number): void {
    if (currentActiveCount >= max) {
      throw ValidationError.of('ACTIVE_SECRET_LIMIT', `app already has ${max} active secrets, revoke one first`);
    }
  }
}
