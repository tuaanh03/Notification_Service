import type { AccountId, AdminId, NormalizedEmail } from '../../../../shared/kernel/index.ts';
import type { Admin } from '../../domain/entities/admin.ts';

export interface AdminRepository {
  findById(id: AdminId): Promise<Admin | null>;
  /** Email đã chuẩn hoá — `uq_admins_account_email` duy nhất theo (account, email). */
  findByEmail(email: NormalizedEmail): Promise<Admin | null>;
  insert(admin: Admin): Promise<void>;
  /** Chỉ ghi `password_hash` + `updated_at` — không đụng email, role. */
  updatePassword(admin: Admin): Promise<void>;
  countByAccount(accountId: AccountId): Promise<number>;
}
