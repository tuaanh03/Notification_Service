import type { AccountId, AdminId, NormalizedEmail } from '../../../../shared/kernel/index.ts';
import type { Admin } from '../../domain/entities/admin.ts';

/** Một trang của màn Danh bạ (Super Admin). */
export interface AdminPage {
  items: Admin[];
  /** Tổng số khớp bộ lọc, không tính phân trang. */
  total: number;
}

export interface AdminRepository {
  findById(id: AdminId): Promise<Admin | null>;
  /** Email đã chuẩn hoá — `uq_admins_account_email` duy nhất theo (account, email). */
  findByEmail(email: NormalizedEmail): Promise<Admin | null>;
  /** Admin đã gắn tài khoản Microsoft này (ADR-0021). */
  findByMicrosoftOid(oid: string): Promise<Admin | null>;
  /** Theo LÔ — màn Thành viên lấy email của cả org bằng một truy vấn, không N+1. */
  findManyByIds(ids: readonly AdminId[]): Promise<Admin[]>;
  /** Mọi admin của một account — danh sách để chọn khi thêm thành viên (ADR-0027). */
  listByAccount(accountId: AccountId): Promise<Admin[]>;
  /**
   * Màn Danh bạ: mọi tài khoản, sắp theo tên (thiếu tên thì email). `search` khớp một phần email
   * hoặc tên; `listed` lọc theo cờ hiện khi thêm thành viên, bỏ trống = cả hai.
   */
  listPage(page: { limit: number; offset: number; search?: string | undefined; listed?: boolean | undefined }): Promise<AdminPage>;
  insert(admin: Admin): Promise<void>;
  /**
   * Như `insert`, nhưng trùng khoá duy nhất (email trong account, `microsoft_oid`) thì trả `false`
   * thay vì ném — hai lần đăng nhập M365 đầu tiên của cùng một người chạy song song (ADR-0024).
   */
  insertIfAbsent(admin: Admin): Promise<boolean>;
  /**
   * Ghi `microsoft_oid` + `updated_at` CHỈ KHI dòng chưa gắn tài khoản nào. `false` = đã có người
   * gắn trước (hai lần đăng nhập đầu tiên chạy song song) — application đọc lại rồi so.
   */
  linkMicrosoft(admin: Admin): Promise<boolean>;
  /** Chỉ ghi `display_name` + `updated_at` (ADR-0027). */
  updateDisplayName(admin: Admin): Promise<void>;
  /** Chỉ ghi `member_listed` + `updated_at`, cho cả lô (cùng giá trị, cùng mốc giờ). */
  updateMemberListed(ids: readonly AdminId[], listed: boolean, at: Date): Promise<void>;
  /** Chỉ ghi `password_hash` + `updated_at` — không đụng email, role. */
  updatePassword(admin: Admin): Promise<void>;
  countByAccount(accountId: AccountId): Promise<number>;
}
