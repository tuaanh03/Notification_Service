import type { CommandContext } from '../../../../shared/application/index.ts';
import type { AdminId, OrgId } from '../../../../shared/kernel/index.ts';
import type { RemoveOrgMember } from '../../../tenancy/application/index.ts';
import type { OrgMemberRemoval } from '../../application/ports/index.ts';

/** Adapter xuyên module: gỡ thành viên qua lệnh công khai của tenancy. */
export class TenancyOrgMemberRemoval implements OrgMemberRemoval {
  private readonly removeOrgMember: RemoveOrgMember;

  constructor(deps: { removeOrgMember: RemoveOrgMember }) {
    this.removeOrgMember = deps.removeOrgMember;
  }

  remove(input: { orgId: OrgId; adminId: AdminId; actorIsOwner?: boolean | undefined }, ctx: CommandContext): Promise<void> {
    return this.removeOrgMember.execute(input, ctx);
  }
}
