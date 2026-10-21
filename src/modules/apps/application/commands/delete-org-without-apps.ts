import type { CommandContext } from '../../../../shared/application/index.ts';
import { ConflictError, type OrgId } from '../../../../shared/kernel/index.ts';
import type { AppRepository, OrgDeletion } from '../ports/index.ts';

/**
 * Xoá tổ chức (2C) — chỉ khi KHÔNG còn app nào đang dùng được (mọi trạng thái trừ `revoked`): xoá dây chuyền là mất khoá
 * API và lịch sử gửi của app đang chạy. App đã thu hồi không chặn (trạng thái kết thúc, không quay lại được).
 *
 * Đặt ở module apps vì chỉ apps đếm được app (apps -> tenancy một chiều, ADR-0011): tenancy khoá dòng org rồi gọi
 * `guard` của lệnh này, nên tạo app mới song song với lệnh xoá không lọt qua chỗ đếm.
 */
export class DeleteOrgWithoutApps {
  private readonly deps: { apps: AppRepository; orgs: OrgDeletion };

  constructor(deps: DeleteOrgWithoutApps['deps']) {
    this.deps = deps;
  }

  async execute(input: { orgId: OrgId; confirmName: string; actorIsOwner: boolean }, ctx: CommandContext): Promise<void> {
    await this.deps.orgs.delete(input, ctx, async () => {
      const live = (await this.deps.apps.listByOrg(input.orgId)).filter((a) => a.status !== 'revoked');
      if (live.length > 0) {
        throw new ConflictError('ORG_HAS_APPS', `organization still has ${live.length} app(s); revoke them first`);
      }
    });
  }
}
