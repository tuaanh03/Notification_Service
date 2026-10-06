import type { AdminId, AppRole } from '../../../../shared/kernel/index.ts';
import type { AdminAppRole } from '../../domain/entities/admin-app-role.ts';

export interface AdminAppRoleRepository {
  /** Vai app CÒN HIỆU LỰC của một người (chưa thu hồi). Mỗi request `/admin` gọi một lần. */
  listByAdmin(adminId: AdminId): Promise<{ appId: string; role: AppRole }[]>;
  /** Cấp mới hoặc đổi vai (khoá chính admin + app); xoá dấu thu hồi nếu có. */
  save(role: AdminAppRole): Promise<void>;
}
