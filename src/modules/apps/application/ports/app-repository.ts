import type { AppId, AppStatus, OrgId } from '../../../../shared/kernel/index.ts';
import type { App } from '../../domain/entities/app.ts';

export interface AppRepository {
  findById(id: AppId): Promise<App | null>;
  listByOrg(orgId: OrgId): Promise<App[]>;
  /** Trùng slug / namespace trong org -> ConflictError. */
  insert(app: App): Promise<void>;
  /**
   * Ghi CÓ ĐIỀU KIỆN: chỉ khi trạng thái trong DB vẫn là `expectedStatus` (trạng thái lúc đọc).
   * Bên kia đã đổi trước -> ConcurrentTransitionError (HTTP 409), không ghi đè lặng lẽ.
   */
  update(app: App, expectedStatus: AppStatus): Promise<void>;
  /**
   * `SELECT ... FOR UPDATE` trên dòng app — tuần tự hoá mọi thay đổi secret của một app (ADR-0009).
   * Chỉ gọi được trong `uow.run`. Trả false nếu app không tồn tại.
   */
  lockForUpdate(id: AppId): Promise<boolean>;
}
