import type { AppRole, OrgId } from '../../../../shared/kernel/index.ts';
import type { AdminAppRoleRepository } from '../ports/index.ts';

/** Vai app còn hiệu lực của mọi người trên các app của một org — một truy vấn (ADR-0026). */
export class ListOrgAppRoles {
  private readonly deps: { roles: AdminAppRoleRepository };

  constructor(deps: ListOrgAppRoles['deps']) {
    this.deps = deps;
  }

  execute(orgId: OrgId): Promise<{ adminId: string; appId: string; role: AppRole }[]> {
    return this.deps.roles.listByOrg(orgId);
  }
}
