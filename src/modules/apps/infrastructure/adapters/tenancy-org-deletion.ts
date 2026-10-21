import type { CommandContext } from '../../../../shared/application/index.ts';
import type { OrgId } from '../../../../shared/kernel/index.ts';
import type { DeleteOrganization } from '../../../tenancy/application/index.ts';
import type { OrgDeletion } from '../../application/ports/index.ts';

/** Adapter xuyên module: xoá tổ chức qua lệnh công khai của tenancy (2C). */
export class TenancyOrgDeletion implements OrgDeletion {
  private readonly deleteOrganization: DeleteOrganization;

  constructor(deps: { deleteOrganization: DeleteOrganization }) {
    this.deleteOrganization = deps.deleteOrganization;
  }

  delete(input: { orgId: OrgId; confirmName: string; actorIsOwner: boolean }, ctx: CommandContext, guard: () => Promise<void>): Promise<void> {
    return this.deleteOrganization.execute(input, ctx, guard);
  }
}
