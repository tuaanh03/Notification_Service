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
  /** Tên hiển thị từ Microsoft 365 (ADR-0027). `null` = chưa biết. */
  displayName?: string | null | undefined;
  /** Có hiện trong hộp "Thêm thành viên" của org không. Thiếu = `true` (cùng mặc định với DB). */
  memberListed?: boolean | undefined;
  /** Lúc bị KHOÁ HẲN vì đăng nhập sai nhiều lần (ADR-0039). `null` = không khoá. */
  lockedAt?: Date | null | undefined;
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
  displayName: string | null;
  memberListed: boolean;
  lockedAt: Date | null;

  constructor(props: AdminProps) {
    super(props.id, props);
    this.accountId = props.accountId;
    this.email = normalizeEmail(props.email);
    this.role = props.role;
    this.passwordHash = props.passwordHash ?? null;
    this.microsoftOid = props.microsoftOid ?? null;
    this.displayName = props.displayName ?? null;
    this.memberListed = props.memberListed ?? true;
    this.lockedAt = props.lockedAt ?? null;
  }

  /** Khoá hẳn (ADR-0039): không vào được bằng mật khẩu lẫn Microsoft, phiên đang mở hết hiệu lực. */
  get isLocked(): boolean {
    return this.lockedAt !== null;
  }

  /** Trả `false` khi đã khoá sẵn — giữ mốc khoá đầu tiên. */
  lock(at: Date): boolean {
    if (this.lockedAt !== null) return false;
    this.lockedAt = at;
    this.touch(at);
    return true;
  }

  /** Trả `false` khi không bị khoá. */
  unlock(at: Date): boolean {
    if (this.lockedAt === null) return false;
    this.lockedAt = null;
    this.touch(at);
    return true;
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

  /**
   * Cập nhật tên theo Microsoft 365. Trả `false` khi không có gì đổi — tên rỗng / thiếu thì giữ tên cũ,
   * không xoá (M365 không trả tên chưa có nghĩa là người đó không còn tên).
   */
  rename(displayName: string | null, at: Date): boolean {
    const next = displayName?.trim().slice(0, 256) || null;
    if (next === null || next === this.displayName) return false;
    this.displayName = next;
    this.touch(at);
    return true;
  }

  /**
   * Super Admin tích / bỏ tích ở màn Danh bạ. Trả `false` khi không có gì đổi. Bỏ tích KHÔNG gỡ người
   * khỏi org họ đang ở — chỉ là không thêm mới vào org nào được nữa.
   */
  setMemberListed(listed: boolean, at: Date): boolean {
    if (this.memberListed === listed) return false;
    this.memberListed = listed;
    this.touch(at);
    return true;
  }

  get isSuperAdmin(): boolean {
    return this.role === 'super_admin';
  }
}
