import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import type { AdminId, Clock, OrgId } from '../../../../shared/kernel/index.ts';
import { APP_AGGREGATE, APP_EVENTS } from '../events.ts';
import type { AdminAppRoleRepository, OrgMemberRemoval } from '../ports/index.ts';

/**
 * Gỡ một người khỏi org VÀ thu hồi mọi vai app của họ trong org đó — CÙNG một transaction
 * (ADR-0026). Không thu hồi thì vai app nằm lại; thêm người đó vào org lần sau là quyền cũ tự
 * sống lại mà không ai cấp.
 *
 * Đặt ở module apps vì apps -> tenancy một chiều (ADR-0011): apps gọi lệnh gỡ của tenancy qua port
 * (`uow.run` lồng nhau nhập vào transaction ngoài), rồi tự thu hồi trên bảng của mình.
 */
export class RemoveMemberFromOrg {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    members: OrgMemberRemoval;
    roles: AdminAppRoleRepository;
  };

  constructor(deps: RemoveMemberFromOrg['deps']) {
    this.deps = deps;
  }

  async execute(input: { orgId: OrgId; adminId: AdminId; actorIsOwner?: boolean | undefined }, ctx: CommandContext): Promise<void> {
    const { uow, outbox, clock, members, roles } = this.deps;
    await uow.run(async () => {
      await members.remove(input, ctx);
      const revoked = await roles.revokeAllInOrg(input.adminId, input.orgId, clock.now());
      if (revoked.length === 0) return;
      await outbox.append(
        revoked.map((appId) => ({
          aggregateType: APP_AGGREGATE,
          aggregateId: appId,
          eventType: APP_EVENTS.roleRevoked,
          payload: audited(ctx, { before: { adminId: input.adminId }, after: { adminId: input.adminId, role: null, reason: 'removed_from_org' } }),
        })),
      );
    });
  }
}
