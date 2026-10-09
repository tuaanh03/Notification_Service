import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import { NotFoundError, OrgId, type AdminId, type Clock } from '../../../../shared/kernel/index.ts';
import { OrgMember } from '../../domain/entities/org-member.ts';
import { Organization } from '../../domain/entities/organization.ts';
import { toOrganizationDto, type OrganizationDto } from '../dto.ts';
import type { AdminRepository, OrganizationRepository, OrgMemberRepository } from '../ports/index.ts';

/**
 * Org tự phục vụ (ADR-0025): người đang đăng nhập tạo org trong account của CHÍNH MÌNH và trở
 * thành Owner — một transaction, nên không bao giờ có org vừa tạo mà thiếu Owner (ADR-0022).
 *
 * Khác `CreateOrganization` (Super Admin, chọn account bất kỳ, không thêm ai vào org).
 */
export class CreateOwnOrganization {
  private readonly deps: {
    uow: UnitOfWork;
    outbox: EventOutbox;
    clock: Clock;
    admins: AdminRepository;
    organizations: OrganizationRepository;
    members: OrgMemberRepository;
  };

  constructor(deps: CreateOwnOrganization['deps']) {
    this.deps = deps;
  }

  async execute(input: { adminId: AdminId; name: string }, ctx: CommandContext): Promise<OrganizationDto> {
    const { uow, outbox, clock, admins, organizations, members } = this.deps;
    return uow.run(async () => {
      const admin = await admins.findById(input.adminId);
      if (admin === null) throw new NotFoundError('admin', input.adminId);
      const now = clock.now();
      const org = new Organization({ id: OrgId.create(), accountId: admin.accountId, name: input.name, createdAt: now });
      await organizations.insert(org);
      await members.save(OrgMember.join(org, admin, 'owner', now));
      await outbox.append([
        {
          aggregateType: 'Organization',
          aggregateId: org.id,
          eventType: 'OrganizationCreated',
          payload: audited(ctx, { after: { accountId: org.accountId, name: org.name } }),
        },
        {
          aggregateType: 'Organization',
          aggregateId: org.id,
          eventType: 'OrgMemberSet',
          payload: audited(ctx, { before: { adminId: admin.id, role: null }, after: { adminId: admin.id, role: 'owner' } }),
        },
      ]);
      return toOrganizationDto(org);
    });
  }
}
