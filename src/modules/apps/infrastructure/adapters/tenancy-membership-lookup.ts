import { AccountId, normalizeEmail, type AdminId, type OrgId, type OrgRole } from '../../../../shared/kernel/index.ts';
import type { FindOrgMemberships } from '../../../tenancy/application/index.ts';
import type { MembershipLookup } from '../../application/ports/index.ts';

/** Adapter xuyên module: hỏi vai org qua query công khai của tenancy, không đọc bảng `org_members`. */
export class TenancyMembershipLookup implements MembershipLookup {
  private readonly memberships: FindOrgMemberships;

  constructor(deps: { memberships: FindOrgMemberships }) {
    this.memberships = deps.memberships;
  }

  rolesOf(adminId: AdminId): Promise<ReadonlyMap<string, OrgRole>> {
    return this.memberships.rolesOf(adminId);
  }

  roleIn(orgId: OrgId, adminId: AdminId): Promise<OrgRole | null> {
    return this.memberships.roleIn(orgId, adminId);
  }

  async adminByEmail(email: string): Promise<{ id: AdminId; accountId: AccountId; email: string } | null> {
    const admin = await this.memberships.adminByEmail(normalizeEmail(email));
    return admin ? { ...admin, accountId: AccountId.parse(admin.accountId) } : null;
  }
}
