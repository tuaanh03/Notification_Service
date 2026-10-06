import {
  BaseEntity,
  normalizeEmail,
  PermissionDeniedError,
  type AccountId,
  type AdminId,
  type AdminRole,
  type NormalizedEmail,
  type TimestampInput,
} from '../../../../shared/kernel/index.ts';

export interface AdminProps extends TimestampInput {
  id: AdminId;
  accountId: AccountId;
  email: string;
  role: AdminRole;
  /**
   * Băm mật khẩu — định dạng do adapter quyết định, domain không biết thuật toán.
   * `null` = chưa đặt mật khẩu -> KHÔNG đăng nhập được. Khác hẳn "mật khẩu rỗng".
   */
  passwordHash?: string | null | undefined;
  /** `oid` của tài khoản Microsoft 365 đã gắn (ADR-0021). `null` = chưa gắn. */
  microsoftOid?: string | null | undefined;
}

/**
 * Admin là TẦNG TRUY CẬP, tách khỏi sở hữu: admin không phải chủ app,
 * chỉ được chạm app qua admin_app_roles. Super Admin là người duy nhất thấy app SYS.
 */
export class Admin extends BaseEntity<AdminId> {
  readonly accountId: AccountId;
  readonly email: NormalizedEmail;
  role: AdminRole;
  passwordHash: string | null;
  microsoftOid: string | null;

  constructor(props: AdminProps) {
    super(props.id, props);
    this.accountId = props.accountId;
    this.email = normalizeEmail(props.email);
    this.role = props.role;
    this.passwordHash = props.passwordHash ?? null;
    this.microsoftOid = props.microsoftOid ?? null;
  }

  /** Chưa đặt mật khẩu thì không có đường đăng nhập nào — đặt bằng CLI (`admin-cli`). */
  get canSignIn(): boolean {
    return this.passwordHash !== null;
  }

  /** Gọi sau khi gán `passwordHash` mới: `updatedAt` là mốc đổi mật khẩu gần nhất. */
  markPasswordChanged(at: Date): void {
    this.touch(at);
  }

  /**
   * Gắn tài khoản Microsoft ở lần đăng nhập M365 đầu tiên. Đã gắn với tài khoản KHÁC thì không đè:
   * email trùng chưa đủ để chuyển quyền sang một danh tính Microsoft khác (ADR-0021).
   */
  linkMicrosoft(oid: string, at: Date): void {
    if (this.microsoftOid !== null && this.microsoftOid !== oid) {
      throw new PermissionDeniedError('M365_ACCOUNT_MISMATCH', 'admin is linked to a different Microsoft account');
    }
    this.microsoftOid = oid;
    this.touch(at);
  }

  get isSuperAdmin(): boolean {
    return this.role === 'super_admin';
  }
}
