import type { AppId, UserId } from '../../../../shared/kernel/index.ts';
import type { User } from '../../domain/entities/user.ts';

/** Một trang người nhận + tổng số, để màn danh sách biết còn bao nhiêu trang. */
export interface UserPage {
  rows: User[];
  total: number;
}

export interface UserRepository {
  /**
   * Người đang dùng theo `(app, external_id)`. Người đã xoá mềm KHÔNG thấy — trừ khi `includeDeleted`
   * (chỉ các lệnh tạo / khai lại dùng, để khôi phục thay vì đụng unique).
   */
  findByExternalId(appId: AppId, externalId: string, opts?: { includeDeleted?: boolean }): Promise<User | null>;
  /**
   * Người nhận ĐANG DÙNG của MỘT app, mới nhất trước. `search` lọc theo `external_id` (khớp một phần).
   * Phạm vi luôn là app — không có đường nào liệt kê xuyên app.
   */
  listByApp(appId: AppId, page: { limit: number; offset: number; search?: string | undefined }): Promise<UserPage>;
  /** Tổng số người nhận đang dùng của MỘT app — cho màn Tổng quan. */
  countByApp(appId: AppId): Promise<number>;
  /** Id người đã xoá mềm của MỘT app — để module khác loại họ ra (phát vào chủ đề, đếm email). */
  deletedIdsByApp(appId: AppId): Promise<UserId[]>;
  /** Tra theo LÔ id, trong phạm vi MỘT app, KỂ CẢ người đã xoá (lịch sử gửi vẫn hiện mã). */
  findManyByIds(appId: AppId, ids: readonly UserId[]): Promise<User[]>;
  /** Đã có user cùng `(app_id, external_id)` -> `UserAlreadyExistsError` (caller thử lại). */
  insert(user: User): Promise<void>;
  /** Ghi trạng thái xoá mềm (`deleted_at`, `updated_at`). */
  update(user: User): Promise<void>;
  /** `SELECT ... FOR UPDATE` trên dòng user — tuần tự hoá mọi thay đổi email của một user. */
  lockForUpdate(id: UserId): Promise<boolean>;
}
