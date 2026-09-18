import {
  CrossAccountViolationError,
  type AccountId,
  type AdminId,
  type AdminRole,
  type AppId,
} from '../../../../shared/kernel/index.ts';

export interface AdminAppRoleProps {
  adminId: AdminId;
  appId: AppId;
  /** Account chung của admin và app — denormalize để ép hai composite FK (ADR-0011). */
  accountId: AccountId;
  role: AdminRole;
  grantedAt?: Date | undefined;
}

/**
 * Cấp quyền chạm một app cụ thể. Khoá chính là (admin_id, app_id) nên đây là
 * entity khoá kép, không kế thừa BaseEntity.
 *
 * LƯU Ý: đây là RBAC thật. Tag `role:*` trên user KHÔNG BAO GIỜ được dùng để
 * kiểm tra quyền — tag chỉ để phân đoạn (OneSignal §5).
 */
export class AdminAppRole {
  readonly adminId: AdminId;
  readonly appId: AppId;
  readonly accountId: AccountId;
  role: AdminRole;
  readonly grantedAt: Date;

  constructor(props: AdminAppRoleProps) {
    this.adminId = props.adminId;
    this.appId = props.appId;
    this.accountId = props.accountId;
    this.role = props.role;
    this.grantedAt = props.grantedAt ?? new Date();
  }

  /**
   * Cấp quyền mới. Admin và app phải cùng account — domain chặn trước, composite FK
   * trong MySQL chặn lần cuối. Nhận dạng cấu trúc tối thiểu thay vì entity `App`,
   * vì domain của tenancy không được import domain của apps.
   */
  static grant(
    admin: { id: AdminId; accountId: AccountId },
    app: { id: AppId; accountId: AccountId },
    role: AdminRole,
    at: Date,
  ): AdminAppRole {
    if (app.accountId !== admin.accountId) {
      throw new CrossAccountViolationError('app', admin.accountId, app.accountId);
    }
    return new AdminAppRole({ adminId: admin.id, appId: app.id, accountId: admin.accountId, role, grantedAt: at });
  }
}
