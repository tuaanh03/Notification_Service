import {
  BaseEntity,
  ValidationError,
  type AppId,
  type AppSecretId,
  type AppSecretStatus,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';

/** Tối đa 2 secret active cùng lúc (UC-001 BR-4) — cho phép xoay vòng không gián đoạn. */
export const MAX_ACTIVE_SECRETS = 2;

export interface AppSecretProps extends TimestampInput {
  id: AppSecretId;
  appId: AppId;
  /** argon2 hash. Plaintext KHÔNG BAO GIỜ được lưu — chỉ trả về đúng một lần lúc tạo. */
  secretHash: string;
  /** Đoạn nhận dạng hiển thị được, ví dụ `nsk_live_…a1b2`. */
  hint: string;
  status?: AppSecretStatus | undefined;
  revokedAt?: Date | null | undefined;
}

export class AppSecret extends BaseEntity<AppSecretId> {
  readonly appId: AppId;
  readonly secretHash: string;
  readonly hint: string;
  status: AppSecretStatus;
  revokedAt: Date | null;

  constructor(props: AppSecretProps) {
    super(props.id, props);
    if (!props.secretHash.trim()) throw ValidationError.of('SECRET_HASH_REQUIRED', 'secretHash must not be empty', 'secretHash');
    this.appId = props.appId;
    this.secretHash = props.secretHash;
    this.hint = props.hint;
    this.status = props.status ?? 'active';
    this.revokedAt = props.revokedAt ?? null;
  }

  revoke(at: Date): void {
    if (this.status === 'revoked') return;
    this.status = 'revoked';
    this.revokedAt = at;
    this.touch(at);
  }

  /**
   * MySQL không có partial unique index nên ràng buộc "≤ 2 active" không ép được ở DB.
   * Command phải gọi hàm này trong cùng transaction với lần insert. Xem ADR-0009.
   */
  static assertCanAddActive(currentActiveCount: number): void {
    if (currentActiveCount >= MAX_ACTIVE_SECRETS) {
      throw ValidationError.of(
        'ACTIVE_SECRET_LIMIT',
        `app already has ${MAX_ACTIVE_SECRETS} active secrets, revoke one first`,
      );
    }
  }
}
