import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminAccess, adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AccountId, AdminId, NotFoundError, OrgId, ORG_ROLES } from '../../../../shared/kernel/index.ts';
import type {
  CreateAccount,
  CreateOrganization,
  CreateOwnOrganization,
  FindOrganization,
  ListDirectoryPeople,
  ListMemberCandidates,
  ListOrgMembers,
  SetMemberListed,
  SetOrgMember,
  SyncTenantDirectory,
  RenameOrganization,
  TransferOrgOwnership,
} from '../../application/index.ts';
import { MAX_DIRECTORY_PAGE, MAX_MEMBER_LISTED_BATCH } from '../../application/index.ts';

const nameBody = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const accountParams = z.object({ accountId: z.string().uuid() });
const orgParams = z.object({ orgId: z.string().uuid() });
const directoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_DIRECTORY_PAGE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Khớp một phần email hoặc tên. Rỗng = không lọc. */
  q: z.string().trim().max(255).optional(),
  /** `yes` / `no` = lọc theo cờ hiện khi thêm thành viên; bỏ trống = cả hai. */
  listed: z.enum(['yes', 'no']).optional(),
});
const memberListedBody = z
  .object({ adminIds: z.array(z.string().uuid()).min(1).max(MAX_MEMBER_LISTED_BATCH), listed: z.boolean() })
  .strict();
const transferBody = z.object({ adminId: z.string().uuid() }).strict();
const memberBody = z.object({ email: z.string().trim().min(3).max(320), role: z.enum(ORG_ROLES) }).strict();

/**
 * `/admin/accounts`, `/admin/organizations` — tối thiểu để dựng tenant. Route chỉ làm ba việc:
 * parse input -> gọi use case -> trả DTO. Không có `if` nghiệp vụ ở đây.
 */
export function adminTenancyRoutes(useCases: {
  createAccount: CreateAccount;
  createOrganization: CreateOrganization;
  createOwnOrganization: CreateOwnOrganization;
  findOrganization: FindOrganization;
  listOrgMembers: ListOrgMembers;
  listMemberCandidates: ListMemberCandidates;
  setOrgMember: SetOrgMember;
  listDirectoryPeople: ListDirectoryPeople;
  setMemberListed: SetMemberListed;
  syncTenantDirectory: SyncTenantDirectory;
  renameOrganization: RenameOrganization;
  transferOrgOwnership: TransferOrgOwnership;
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });

    app.post('/accounts', { config: access('platform.manage') }, async (request, reply) => {
      const body = parseInput(nameBody, request.body);
      return reply.status(201).send(await useCases.createAccount.execute(body, ctx(request)));
    });

    app.post('/accounts/:accountId/organizations', { config: access('platform.manage') }, async (request, reply) => {
      const { accountId } = parseInput(accountParams, request.params);
      const body = parseInput(nameBody, request.body);
      const org = await useCases.createOrganization.execute(
        { accountId: AccountId.parse(accountId), name: body.name },
        ctx(request),
      );
      return reply.status(201).send(org);
    });

    // Org tự phục vụ (ADR-0025): ai đăng nhập cũng tạo được, người tạo thành Owner.
    app.post('/organizations', { config: access('org.create') }, async (request, reply) => {
      const body = parseInput(nameBody, request.body);
      const org = await useCases.createOwnOrganization.execute(
        { adminId: AdminId.parse(adminCaller(request).adminId), name: body.name },
        ctx(request),
      );
      return reply.status(201).send(org);
    });

    // Màn Thành viên (ADR-0026). Gỡ thành viên ở module apps — kèm thu hồi vai app.
    app.get('/organizations/:orgId/members', { config: access('org.read') }, async (request) => {
      const { orgId } = parseInput(orgParams, request.params);
      return useCases.listOrgMembers.execute(OrgId.parse(orgId));
    });

    // Người có thể thêm vào org: tài khoản cùng account, chưa là thành viên (ADR-0027).
    app.get('/organizations/:orgId/member-candidates', { config: access('org.manage') }, async (request) => {
      const { orgId } = parseInput(orgParams, request.params);
      return useCases.listMemberCandidates.execute(OrgId.parse(orgId));
    });

    // Đồng bộ danh bạ tenant M365 thành tài khoản EWS — việc cấp hệ thống, chỉ Super Admin (ADR-0027).
    app.post('/directory/m365-sync', { config: access('platform.manage') }, async (request) =>
      useCases.syncTenantDirectory.execute(ctx(request)),
    );

    // Màn Danh bạ: Super Admin chọn ai hiện trong hộp "Thêm thành viên" của mọi org.
    app.get('/directory/people', { config: access('platform.manage') }, async (request) => {
      const { limit, offset, q, listed } = parseInput(directoryQuery, request.query);
      return useCases.listDirectoryPeople.execute({
        limit,
        offset,
        search: q,
        listed: listed === undefined ? undefined : listed === 'yes',
      });
    });

    app.put('/directory/people/member-listed', { config: access('platform.manage') }, async (request) => {
      const body = parseInput(memberListedBody, request.body);
      return useCases.setMemberListed.execute({ adminIds: body.adminIds.map(AdminId.parse), listed: body.listed }, ctx(request));
    });

    app.put('/organizations/:orgId/members', { config: access('org.manage') }, async (request) => {
      const { orgId } = parseInput(orgParams, request.params);
      const body = parseInput(memberBody, request.body);
      const caller = adminAccess(request);
      return useCases.setOrgMember.execute(
        {
          orgId: OrgId.parse(orgId),
          email: body.email,
          role: body.role,
          actorIsOwner: caller.isSuperAdmin || caller.orgRoles.get(orgId) === 'owner',
        },
        ctx(request),
      );
    });

    // Quản lý tổ chức (2C) — chỉ Owner / Super Admin (lệnh tự kiểm `OWNER_REQUIRED`). Xoá tổ chức ở module apps (đếm app).
    app.patch('/organizations/:orgId', { config: access('org.manage') }, async (request) => {
      const { orgId } = parseInput(orgParams, request.params);
      const body = parseInput(nameBody, request.body);
      const caller = adminAccess(request);
      return useCases.renameOrganization.execute(
        { orgId: OrgId.parse(orgId), name: body.name, actorIsOwner: caller.isSuperAdmin || caller.orgRoles.get(orgId) === 'owner' },
        ctx(request),
      );
    });

    app.post('/organizations/:orgId/transfer-owner', { config: access('org.manage') }, async (request, reply) => {
      const { orgId } = parseInput(orgParams, request.params);
      const body = parseInput(transferBody, request.body);
      const caller = adminAccess(request);
      await useCases.transferOrgOwnership.execute(
        { orgId: OrgId.parse(orgId), adminId: AdminId.parse(body.adminId), actorIsOwner: caller.isSuperAdmin || caller.orgRoles.get(orgId) === 'owner' },
        ctx(request),
      );
      return reply.status(204).send();
    });

    app.get('/organizations/:orgId', { config: access('org.read') }, async (request) => {
      const { orgId } = parseInput(orgParams, request.params);
      const org = await useCases.findOrganization.execute(OrgId.parse(orgId));
      if (!org) throw new NotFoundError('organization', orgId);
      return org;
    });
  };
}
