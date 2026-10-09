import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, normalizeEmail, ValidationError, type Clock, type OrgId, type OrgRole } from '../../../../shared/kernel/index.ts';
import { OrgMember } from '../../domain/entities/org-member.ts';
import { assertMayTouchOwner, assertOwnerRemains } from '../../domain/rules/org-ownership.ts';
import type { AdminRepository, OrganizationRepository, OrgMemberRepository } from '../ports/index.ts';

export interface OrgMemberDto {
  orgId: string;
  adminId: string;
  email: string;
  role: OrgRole;
}

/**
 * Thêm người (đã có tài khoản) vào org, hoặc đổi vai của họ (ADR-0022, ADR-0026). Khoá dòng org
 * TRƯỚC khi đọc / đếm owner (ADR-0009): hai lệnh hạ vai owner chạy song song không được cùng lọt.
 *
 * Email chưa có tài khoản -> 422 `ADMIN_NOT_REGISTERED`: người đó cần đăng nhập Microsoft 365 một
 * lần để có tài khoản (ADR-0024). Không dùng 404 — 404 trên route này nghĩa là "không thấy org".
 */
export class SetOrgMember {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    organizations: OrganizationRepository;
    admins: AdminRepository;
    members: OrgMemberRepository;
  };

  constructor(deps: SetOrgMember['deps']) {
    this.deps = deps;
  }

  async execute(
    input: {
      orgId: OrgId;
      email: string;
      role: OrgRole;
      /** Người gọi có phải Owner / Super Admin không. `undefined` = `admin-cli` (lệnh hệ thống). */
      actorIsOwner?: boolean | undefined;
    },
    ctx: CommandContext,
  ): Promise<OrgMemberDto> {
    const { uow, outbox, clock, organizations, admins, members } = this.deps;
    return uow.run(async () => {
      if (!(await organizations.lockForUpdate(input.orgId))) throw new NotFoundError('organization', input.orgId);
      const org = (await organizations.findById(input.orgId))!;
      const admin = await admins.findByEmail(normalizeEmail(input.email));
      if (admin === null) {
        throw ValidationError.of('ADMIN_NOT_REGISTERED', 'no EWS account with this email yet', 'email');
      }

      const now = clock.now();
      const current = await members.find(org.id, admin.id);
      assertMayTouchOwner({ actorIsOwner: input.actorIsOwner, currentRole: current?.role ?? null, nextRole: input.role });
      assertOwnerRemains({
        currentRole: current?.role ?? null,
        nextRole: input.role,
        owners: current?.role === 'owner' ? await members.countOwners(org.id) : Number.POSITIVE_INFINITY,
      });
      const member = current ?? OrgMember.join(org, admin, input.role, now);
      const before = current?.role ?? null;
      member.changeRole(input.role, now);
      await members.save(member);

      await outbox.append([
        {
          aggregateType: 'Organization',
          aggregateId: org.id,
          eventType: 'OrgMemberSet',
          payload: audited(ctx, { before: { adminId: admin.id, role: before }, after: { adminId: admin.id, role: input.role } }),
        },
      ]);
      return { orgId: org.id, adminId: admin.id, email: admin.email, role: input.role };
    });
  }
}
