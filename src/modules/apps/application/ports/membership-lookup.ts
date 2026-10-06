import type { AccountId, AdminId, OrgId, OrgRole } from '../../../../shared/kernel/index.ts';

/**
 * Vai trong org thuộc module tenancy -> hỏi qua port; adapter gọi query công khai của tenancy,
 * KHÔNG đọc bảng `org_members` (ADR-0022).
 */
export interface MembershipLookup {
  /** Mọi org của người này -> vai. */
  rolesOf(adminId: AdminId): Promise<ReadonlyMap<string, OrgRole>>;
  roleIn(orgId: OrgId, adminId: AdminId): Promise<OrgRole | null>;
  adminByEmail(email: string): Promise<{ id: AdminId; accountId: AccountId; email: string } | null>;
}
