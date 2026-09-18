import type { AdminId, AdminRole, AppId } from '../../../shared/kernel/index.ts';

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
  role: AdminRole;
  readonly grantedAt: Date;

  constructor(props: { adminId: AdminId; appId: AppId; role: AdminRole; grantedAt?: Date | undefined }) {
    this.adminId = props.adminId;
    this.appId = props.appId;
    this.role = props.role;
    this.grantedAt = props.grantedAt ?? new Date();
  }
}
