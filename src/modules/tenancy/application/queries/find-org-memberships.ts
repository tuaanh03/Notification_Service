import type { AdminId, NormalizedEmail, OrgId, OrgRole } from '../../../../shared/kernel/index.ts';
import type { AdminRepository, OrgMemberRepository } from '../ports/index.ts';

/**
 * Query công khai của tenancy cho lớp kiểm quyền (module apps, qua adapter — ADR-0022): vai của một
 * người trong các org, và tra admin theo email cho lệnh cấp vai app.
 */
export class FindOrgMemberships {
  private readonly deps: { members: OrgMemberRepository; admins: AdminRepository };

  constructor(deps: FindOrgMemberships['deps']) {
    this.deps = deps;
  }

  /** Mọi org của người này -> vai. Map rỗng = chưa thuộc org nào. */
  async rolesOf(adminId: AdminId): Promise<Map<string, OrgRole>> {
    const rows = await this.deps.members.listByAdmin(adminId);
    return new Map(rows.map((m) => [m.orgId as string, m.role]));
  }

  async roleIn(orgId: OrgId, adminId: AdminId): Promise<OrgRole | null> {
    return (await this.deps.members.find(orgId, adminId))?.role ?? null;
  }

  async adminByEmail(email: NormalizedEmail): Promise<{ id: AdminId; accountId: string; email: string } | null> {
    const admin = await this.deps.admins.findByEmail(email);
    return admin ? { id: admin.id, accountId: admin.accountId, email: admin.email } : null;
  }
}
