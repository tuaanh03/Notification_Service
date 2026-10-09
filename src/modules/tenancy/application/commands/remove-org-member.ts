import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, type AdminId, type OrgId } from '../../../../shared/kernel/index.ts';
import { assertMayTouchOwner, assertOwnerRemains } from '../../domain/rules/org-ownership.ts';
import type { OrganizationRepository, OrgMemberRepository } from '../ports/index.ts';

/**
 * Gỡ một người khỏi org (ADR-0026). Khoá dòng org rồi mới đếm owner (ADR-0009) — gỡ Owner cuối cùng
 * -> 409 `LAST_OWNER`; chỉ Owner gỡ được Owner -> 403 `OWNER_REQUIRED`.
 *
 * Vai app của người đó trong org KHÔNG thu hồi ở đây (bảng thuộc module apps): module apps gọi lệnh
 * này trong CÙNG transaction rồi tự thu hồi (`apps/RemoveOrgMember`).
 */
export class RemoveOrgMember {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    organizations: OrganizationRepository;
    members: OrgMemberRepository;
  };

  constructor(deps: RemoveOrgMember['deps']) {
    this.deps = deps;
  }

  async execute(
    input: { orgId: OrgId; adminId: AdminId; actorIsOwner?: boolean | undefined },
    ctx: CommandContext,
  ): Promise<void> {
    const { uow, outbox, organizations, members } = this.deps;
    await uow.run(async () => {
      if (!(await organizations.lockForUpdate(input.orgId))) throw new NotFoundError('organization', input.orgId);
      const current = await members.find(input.orgId, input.adminId);
      if (current === null) throw new NotFoundError('member', input.adminId);
      assertMayTouchOwner({ actorIsOwner: input.actorIsOwner, currentRole: current.role, nextRole: null });
      assertOwnerRemains({
        currentRole: current.role,
        nextRole: null,
        owners: current.role === 'owner' ? await members.countOwners(input.orgId) : Number.POSITIVE_INFINITY,
      });
      await members.remove(input.orgId, input.adminId);
      await outbox.append([
        {
          aggregateType: 'Organization',
          aggregateId: input.orgId,
          eventType: 'OrgMemberRemoved',
          payload: audited(ctx, { before: { adminId: input.adminId, role: current.role }, after: { adminId: input.adminId, role: null } }),
        },
      ]);
    });
  }
}
