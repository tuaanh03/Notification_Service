import type { AccountId, AdminId, NormalizedEmail } from '../../../../shared/kernel/index.ts';
import type { Admin } from '../../domain/entities/admin.ts';

export interface AdminRepository {
  findById(id: AdminId): Promise<Admin | null>;
  /** Email đã chuẩn hoá — `uq_admins_account_email` duy nhất theo (account, email). */
  findByEmail(email: NormalizedEmail): Promise<Admin | null>;
  /** Admin đã gắn tài khoản Microsoft này (ADR-0021). */
  findByMicrosoftOid(oid: string): Promise<Admin | null>;
  insert(admin: Admin): Promise<void>;
  /**
   * Ghi `microsoft_oid` + `updated_at` CHỈ KHI dòng chưa gắn tài khoản nào. `false` = đã có người
   * gắn trước (hai lần đăng nhập đầu tiên chạy song song) — application đọc lại rồi so.
   */
  linkMicrosoft(admin: Admin): Promise<boolean>;
  /** Chỉ ghi `password_hash` + `updated_at` — không đụng email, role. */
  updatePassword(admin: Admin): Promise<void>;
  countByAccount(accountId: AccountId): Promise<number>;
}
