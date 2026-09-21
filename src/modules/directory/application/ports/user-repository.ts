import type { AppId, UserId } from '../../../../shared/kernel/index.ts';
import type { User } from '../../domain/entities/user.ts';

/** Một trang người nhận + tổng số, để màn danh sách biết còn bao nhiêu trang. */
export interface UserPage {
  rows: User[];
  total: number;
}

export interface UserRepository {
  findByExternalId(appId: AppId, externalId: string): Promise<User | null>;
  /**
   * Người nhận của MỘT app, mới nhất trước. `search` lọc theo `external_id` (khớp một phần).
   * Phạm vi luôn là app — không có đường nào liệt kê xuyên app.
   */
  listByApp(appId: AppId, page: { limit: number; offset: number; search?: string | undefined }): Promise<UserPage>;
  /** Tra theo LÔ id, trong phạm vi MỘT app — id của app khác bị bỏ qua, không lỗi. */
  findManyByIds(appId: AppId, ids: readonly UserId[]): Promise<User[]>;
  /** Đã có user cùng `(app_id, external_id)` -> `UserAlreadyExistsError` (caller thử lại). */
  insert(user: User): Promise<void>;
  /** `SELECT ... FOR UPDATE` trên dòng user — tuần tự hoá mọi thay đổi email của một user. */
  lockForUpdate(id: UserId): Promise<boolean>;
}
