import type { AdminId, OrgId } from '../../../../shared/kernel/index.ts';
import type { OrgMember } from '../../domain/entities/org-member.ts';

export interface OrgMemberRepository {
  find(orgId: OrgId, adminId: AdminId): Promise<OrgMember | null>;
  /** Mọi org của một người — mỗi request `/admin` gọi một lần (một truy vấn, theo index admin_id). */
  listByAdmin(adminId: AdminId): Promise<OrgMember[]>;
  /** Mọi thành viên của một org (màn Thành viên — ADR-0026). */
  listByOrg(orgId: OrgId): Promise<OrgMember[]>;
  /** Gọi SAU khi đã khoá dòng org (`OrganizationRepository.lockForUpdate`). */
  countOwners(orgId: OrgId): Promise<number>;
  /** Thêm mới hoặc đổi vai (khoá chính org + admin). */
  save(member: OrgMember): Promise<void>;
  /** Gỡ khỏi org. Gọi SAU khi đã khoá dòng org. */
  remove(orgId: OrgId, adminId: AdminId): Promise<void>;
  /** Gỡ mọi thành viên (xoá tổ chức — 2C). Gọi SAU khi đã khoá dòng org. */
  removeAll(orgId: OrgId): Promise<void>;
}
