import {
  BaseEntity,
  normalizeEmail,
  type AccountId,
  type AdminId,
  type AdminRole,
  type NormalizedEmail,
  type TimestampInput,
} from '../../../shared/kernel/index.ts';

export interface AdminProps extends TimestampInput {
  id: AdminId;
  accountId: AccountId;
  email: string;
  role: AdminRole;
}

/**
 * Admin là TẦNG TRUY CẬP, tách khỏi sở hữu: admin không phải chủ app,
 * chỉ được chạm app qua admin_app_roles. Super Admin là người duy nhất thấy app SYS.
 */
export class Admin extends BaseEntity<AdminId> {
  readonly accountId: AccountId;
  readonly email: NormalizedEmail;
  role: AdminRole;

  constructor(props: AdminProps) {
    super(props.id, props);
    this.accountId = props.accountId;
    this.email = normalizeEmail(props.email);
    this.role = props.role;
  }

  get isSuperAdmin(): boolean {
    return this.role === 'super_admin';
  }
}
