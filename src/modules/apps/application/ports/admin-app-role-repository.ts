import type { AdminId, AppId, AppRole, OrgId } from '../../../../shared/kernel/index.ts';
import type { AdminAppRole } from '../../domain/entities/admin-app-role.ts';

export interface AdminAppRoleRepository {
  /** Vai app CÒN HIỆU LỰC của một người (chưa thu hồi). Mỗi request `/admin` gọi một lần. */
  listByAdmin(adminId: AdminId): Promise<{ appId: string; role: AppRole }[]>;
  /** Cấp mới hoặc đổi vai (khoá chính admin + app); xoá dấu thu hồi nếu có. */
  save(role: AdminAppRole): Promise<void>;
  /** Vai app còn hiệu lực của MỌI người trên các app của một org (màn Thành viên — ADR-0026). */
  listByOrg(orgId: OrgId): Promise<{ adminId: string; appId: string; role: AppRole }[]>;
  /** Đánh dấu thu hồi. `false` = không có vai nào đang hiệu lực để thu hồi. */
  revoke(adminId: AdminId, appId: AppId, at: Date): Promise<boolean>;
  /** Thu hồi mọi vai app của một người trên các app của org (khi gỡ khỏi org). Trả các app bị thu hồi. */
  revokeAllInOrg(adminId: AdminId, orgId: OrgId, at: Date): Promise<string[]>;
}
