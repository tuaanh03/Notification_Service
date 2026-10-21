import { audited, type CommandContext, type EventOutbox, type UnitOfWork } from '../../../../shared/application/index.ts';
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  type AdminId,
  type Clock,
  type OrgId,
} from '../../../../shared/kernel/index.ts';
import { toOrganizationDto, type OrganizationDto } from '../dto.ts';
import type { OrganizationRepository, OrgMemberRepository } from '../ports/index.ts';

type Deps = { uow: UnitOfWork; outbox: EventOutbox; clock: Clock; organizations: OrganizationRepository; members: OrgMemberRepository };

/** Chỉ Owner của org (hoặc Super Admin) — Org Admin quản thành viên được nhưng không đổi tên / chuyển Owner / xoá org. */
function requireOwner(actorIsOwner: boolean): void {
  if (!actorIsOwner) throw new PermissionDeniedError('OWNER_REQUIRED', 'only an owner can rename, transfer or delete the organization');
}

/** Khoá dòng org rồi đọc (ADR-0009). Org đã xoá / không có -> 404. */
async function lockOrg(organizations: OrganizationRepository, orgId: OrgId) {
  if (!(await organizations.lockForUpdate(orgId))) throw new NotFoundError('organization', orgId);
  const org = await organizations.findById(orgId);
  if (org === null) throw new NotFoundError('organization', orgId);
  return org;
}

/** Đổi tên tổ chức (2C) — Owner / Super Admin. Không đổi gì -> không ghi, không audit. */
export class RenameOrganization {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: { orgId: OrgId; name: string; actorIsOwner: boolean }, ctx: CommandContext): Promise<OrganizationDto> {
    requireOwner(input.actorIsOwner);
    const { uow, outbox, clock, organizations } = this.deps;
    return uow.run(async () => {
      const org = await lockOrg(organizations, input.orgId);
      const before = org.name;
      if (!org.rename(input.name, clock.now())) return toOrganizationDto(org);
      await organizations.rename(org);
      await outbox.append([
        {
          aggregateType: 'Organization',
          aggregateId: org.id,
          eventType: 'OrganizationRenamed',
          payload: audited(ctx, { before: { name: before }, after: { name: org.name } }),
        },
      ]);
      return toOrganizationDto(org);
    });
  }
}

/**
 * Chuyển Owner (2C): người được chọn (đã là thành viên) thành Owner; MỌI Owner hiện tại khác thành Org Admin — vẫn ở lại
 * org, vẫn quản được thành viên. Cùng một transaction sau khi khoá dòng org, nên org không lúc nào thiếu Owner.
 */
export class TransferOrgOwnership {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(input: { orgId: OrgId; adminId: AdminId; actorIsOwner: boolean }, ctx: CommandContext): Promise<void> {
    requireOwner(input.actorIsOwner);
    const { uow, outbox, clock, organizations, members } = this.deps;
    await uow.run(async () => {
      const org = await lockOrg(organizations, input.orgId);
      const target = await members.find(org.id, input.adminId);
      if (target === null) throw ValidationError.of('NOT_ORG_MEMBER', 'the new owner must already be a member of the organization', 'adminId');
      if (target.role === 'owner') return;
      const now = clock.now();
      const previous = (await members.listByOrg(org.id)).filter((m) => m.role === 'owner');
      for (const owner of previous) {
        owner.changeRole('org_admin', now);
        await members.save(owner);
      }
      target.changeRole('owner', now);
      await members.save(target);
      await outbox.append([
        {
          aggregateType: 'Organization',
          aggregateId: org.id,
          eventType: 'OrgOwnerTransferred',
          payload: audited(ctx, {
            before: { owners: previous.map((m) => m.adminId) },
            after: { owner: target.adminId, previousOwnersBecame: 'org_admin' },
          }),
        },
      ]);
    });
  }
}

/**
 * Xoá tổ chức (2C) — Owner / Super Admin, phải gõ lại đúng tên (`ORG_NAME_MISMATCH`). Xoá MỀM + gỡ mọi thành viên trong
 * cùng transaction. `guard` chạy SAU khi đã khoá dòng org — module apps truyền vào để chặn khi org còn app
 * (`ORG_HAS_APPS`); tenancy không đọc bảng của apps (luật kiến trúc).
 */
export class DeleteOrganization {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async execute(
    input: { orgId: OrgId; confirmName: string; actorIsOwner: boolean },
    ctx: CommandContext,
    guard: () => Promise<void> = async () => {},
  ): Promise<void> {
    requireOwner(input.actorIsOwner);
    const { uow, outbox, clock, organizations, members } = this.deps;
    await uow.run(async () => {
      const org = await lockOrg(organizations, input.orgId);
      if (input.confirmName.trim() !== org.name) {
        throw ValidationError.of('ORG_NAME_MISMATCH', 'type the organization name exactly to confirm', 'confirmName');
      }
      await guard();
      const memberCount = (await members.listByOrg(org.id)).length;
      await members.removeAll(org.id);
      await organizations.markDeleted(org.id, clock.now());
      await outbox.append([
        {
          aggregateType: 'Organization',
          aggregateId: org.id,
          eventType: 'OrganizationDeleted',
          payload: audited(ctx, { before: { name: org.name, members: memberCount }, after: { deleted: true } }),
        },
      ]);
    });
  }
}
