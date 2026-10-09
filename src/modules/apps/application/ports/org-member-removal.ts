import type { CommandContext } from '../../../../shared/application/index.ts';
import type { AdminId, OrgId } from '../../../../shared/kernel/index.ts';

/**
 * Gỡ thành viên org thuộc module tenancy -> gọi qua port; adapter gọi lệnh công khai của tenancy
 * (`RemoveOrgMember`), không xoá bảng `org_members` (ADR-0026).
 */
export interface OrgMemberRemoval {
  remove(input: { orgId: OrgId; adminId: AdminId; actorIsOwner?: boolean | undefined }, ctx: CommandContext): Promise<void>;
}
