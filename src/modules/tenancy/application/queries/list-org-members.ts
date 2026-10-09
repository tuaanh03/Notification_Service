import type { OrgId } from '../../../../shared/kernel/index.ts';
import type { OrgMemberDto } from '../commands/set-org-member.ts';
import type { AdminRepository, OrgMemberRepository } from '../ports/index.ts';

/**
 * Thành viên của một org kèm email (màn Thành viên — ADR-0026). Hai truy vấn cho cả org: danh sách
 * thành viên + email theo lô (CLAUDE.md: đường `/admin` đọc nhiều bản ghi lấy dữ liệu theo LÔ).
 */
export class ListOrgMembers {
  private readonly deps: { members: OrgMemberRepository; admins: AdminRepository };

  constructor(deps: ListOrgMembers['deps']) {
    this.deps = deps;
  }

  async execute(orgId: OrgId): Promise<OrgMemberDto[]> {
    const members = await this.deps.members.listByOrg(orgId);
    const admins = await this.deps.admins.findManyByIds(members.map((m) => m.adminId));
    const emailOf = new Map(admins.map((a) => [a.id as string, a.email as string]));
    return members
      .map((m) => ({ orgId: m.orgId as string, adminId: m.adminId as string, email: emailOf.get(m.adminId) ?? '', role: m.role }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }
}
