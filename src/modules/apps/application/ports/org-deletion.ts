import type { CommandContext } from '../../../../shared/application/index.ts';
import type { OrgId } from '../../../../shared/kernel/index.ts';

/** Xoá tổ chức thuộc module tenancy -> gọi qua port; `guard` chạy sau khi tenancy đã khoá dòng org (2C). */
export interface OrgDeletion {
  delete(
    input: { orgId: OrgId; confirmName: string; actorIsOwner: boolean },
    ctx: CommandContext,
    guard: () => Promise<void>,
  ): Promise<void>;
}
