import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminAccess, adminCaller, adminContext, doc, type HttpRoutes, parseInput } from '../../../../shared/http/index.ts';
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
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);
    const tag = 'organizations';
    const ownerRequired = { status: 403, code: 'OWNER_REQUIRED' };

    app.post(
      '/accounts',
      {
        config: {
          ...access('platform.manage'),
          ...doc({ tag, summary: 'Super Admin: create an account (the company that owns organizations).', body: nameBody, status: 201, responseDto: 'AccountDto' }),
        },
      },
      async (request, reply) => {
        const body = parseInput(nameBody, request.body);
        return reply.status(201).send(await useCases.createAccount.execute(body, ctx(request)));
      },
    );

    app.post(
      '/accounts/:accountId/organizations',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag,
            summary: 'Super Admin: create an organization in a given account, with no members.',
            description: 'Unlike `POST /organizations`, nobody becomes Owner — add one with `PUT /organizations/{orgId}/members`.',
            params: accountParams,
            body: nameBody,
            status: 201,
            responseDto: 'OrganizationDto',
          }),
        },
      },
      async (request, reply) => {
        const { accountId } = parseInput(accountParams, request.params);
        const body = parseInput(nameBody, request.body);
        const org = await useCases.createOrganization.execute(
          { accountId: AccountId.parse(accountId), name: body.name },
          ctx(request),
        );
        return reply.status(201).send(org);
      },
    );

    // Org tự phục vụ (ADR-0025): ai đăng nhập cũng tạo được, người tạo thành Owner.
    app.post(
      '/organizations',
      {
        config: {
          ...access('org.create'),
          ...doc({
            tag,
            summary: 'Create an organization in your own account; you become its Owner.',
            body: nameBody,
            example: { name: 'Phòng Hạ tầng' },
            status: 201,
            responseDto: 'OrganizationDto',
          }),
        },
      },
      async (request, reply) => {
        const body = parseInput(nameBody, request.body);
        const org = await useCases.createOwnOrganization.execute(
          { adminId: AdminId.parse(adminCaller(request).adminId), name: body.name },
          ctx(request),
        );
        return reply.status(201).send(org);
      },
    );

    // Màn Thành viên (ADR-0026). Gỡ thành viên ở module apps — kèm thu hồi vai app.
    app.get(
      '/organizations/:orgId/members',
      { config: { ...access('org.read'), ...doc({ tag, summary: 'List the members of an organization with their role.', params: orgParams, responseDto: 'OrgMemberDto[]' }) } },
      async (request) => {
        const { orgId } = parseInput(orgParams, request.params);
        return useCases.listOrgMembers.execute(OrgId.parse(orgId));
      },
    );

    // Người có thể thêm vào org: tài khoản cùng account, chưa là thành viên (ADR-0027).
    app.get(
      '/organizations/:orgId/member-candidates',
      {
        config: {
          ...access('org.manage'),
          ...doc({
            tag,
            summary: 'List the accounts that can be added to an organization.',
            description:
              'Accounts in the same account as the organization that a Super Admin has listed in the directory (`memberListed`), minus current members. Accounts come from the Microsoft 365 directory sync or a first Microsoft 365 sign-in.',
            params: orgParams,
            responseDto: 'MemberCandidateDto[]',
          }),
        },
      },
      async (request) => {
        const { orgId } = parseInput(orgParams, request.params);
        return useCases.listMemberCandidates.execute(OrgId.parse(orgId));
      },
    );

    // Đồng bộ danh bạ tenant M365 thành tài khoản EWS — việc cấp hệ thống, chỉ Super Admin (ADR-0027).
    app.post(
      '/directory/m365-sync',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag: 'directory',
            summary: 'Super Admin: sync the Microsoft 365 tenant directory into EWS accounts.',
            description:
              'Same rules as a first Microsoft 365 sign-in: links existing accounts by email, renames, creates missing ones (role `user`, no password, hidden from "add member" until listed). Never deletes or locks anyone. Safe to re-run. Runs synchronously — on a large tenant the call takes a while.',
            responseDto: 'DirectorySyncDto',
            errors: [
              { status: 422, code: 'NO_ACCOUNT' },
              { status: 502, code: 'M365_DIRECTORY_ERROR' },
              { status: 503, code: 'M365_DIRECTORY_NOT_CONFIGURED' },
              { status: 503, code: 'M365_DIRECTORY_TENANT_MISMATCH' },
            ],
          }),
        },
      },
      async (request) => useCases.syncTenantDirectory.execute(ctx(request)),
    );

    // Màn Danh bạ: Super Admin chọn ai hiện trong hộp "Thêm thành viên" của mọi org.
    app.get(
      '/directory/people',
      {
        config: {
          ...access('platform.manage'),
          ...doc({ tag: 'directory', summary: 'Super Admin: list every EWS account, paged, with its "listed" flag.', query: directoryQuery, responseDto: 'DirectoryPeoplePage' }),
        },
      },
      async (request) => {
        const { limit, offset, q, listed } = parseInput(directoryQuery, request.query);
        return useCases.listDirectoryPeople.execute({
          limit,
          offset,
          search: q,
          listed: listed === undefined ? undefined : listed === 'yes',
        });
      },
    );

    app.put(
      '/directory/people/member-listed',
      {
        config: {
          ...access('platform.manage'),
          ...doc({
            tag: 'directory',
            summary: 'Super Admin: show or hide accounts in the "add member" picker of every organization.',
            description: 'Unknown ids are ignored. Hiding someone does not remove them from organizations they are already in. Returns how many accounts actually changed.',
            body: memberListedBody,
            responseDto: '{ changed: number }',
          }),
        },
      },
      async (request) => {
        const body = parseInput(memberListedBody, request.body);
        return useCases.setMemberListed.execute({ adminIds: body.adminIds.map(AdminId.parse), listed: body.listed }, ctx(request));
      },
    );

    app.put(
      '/organizations/:orgId/members',
      {
        config: {
          ...access('org.manage'),
          ...doc({
            tag,
            summary: 'Add a member to an organization, or change their role.',
            description:
              'The person must already have an EWS account (`ADMIN_NOT_REGISTERED`) and, when added for the first time, be listed by a Super Admin (`ADMIN_NOT_LISTED`). Only an Owner or Super Admin can grant, change or remove the `owner` role (`OWNER_REQUIRED`); the organization always keeps at least one Owner (`LAST_OWNER`). To remove a member use `DELETE /organizations/{orgId}/members/{adminId}`.',
            params: orgParams,
            body: memberBody,
            example: { email: 'an.nguyen@company.com', role: 'member' },
            responseDto: 'OrgMemberDto',
            errors: [
              { status: 403, code: 'CROSS_ACCOUNT' },
              ownerRequired,
              { status: 409, code: 'LAST_OWNER' },
              { status: 422, code: 'ADMIN_NOT_LISTED' },
              { status: 422, code: 'ADMIN_NOT_REGISTERED' },
            ],
          }),
        },
      },
      async (request) => {
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
      },
    );

    // Quản lý tổ chức (2C) — chỉ Owner / Super Admin (lệnh tự kiểm `OWNER_REQUIRED`). Xoá tổ chức ở module apps (đếm app).
    app.patch(
      '/organizations/:orgId',
      {
        config: {
          ...access('org.manage'),
          ...doc({ tag, summary: 'Rename an organization (Owner or Super Admin only).', params: orgParams, body: nameBody, responseDto: 'OrganizationDto', errors: [ownerRequired] }),
        },
      },
      async (request) => {
        const { orgId } = parseInput(orgParams, request.params);
        const body = parseInput(nameBody, request.body);
        const caller = adminAccess(request);
        return useCases.renameOrganization.execute(
          { orgId: OrgId.parse(orgId), name: body.name, actorIsOwner: caller.isSuperAdmin || caller.orgRoles.get(orgId) === 'owner' },
          ctx(request),
        );
      },
    );

    app.post(
      '/organizations/:orgId/transfer-owner',
      {
        config: {
          ...access('org.manage'),
          ...doc({
            tag,
            summary: 'Make an existing member the Owner (Owner or Super Admin only).',
            description: 'Every current Owner becomes Org Admin and stays in the organization. Transferring to someone who is already Owner is a no-op.',
            params: orgParams,
            body: transferBody,
            status: 204,
            errors: [ownerRequired, { status: 422, code: 'NOT_ORG_MEMBER' }],
          }),
        },
      },
      async (request, reply) => {
        const { orgId } = parseInput(orgParams, request.params);
        const body = parseInput(transferBody, request.body);
        const caller = adminAccess(request);
        await useCases.transferOrgOwnership.execute(
          { orgId: OrgId.parse(orgId), adminId: AdminId.parse(body.adminId), actorIsOwner: caller.isSuperAdmin || caller.orgRoles.get(orgId) === 'owner' },
          ctx(request),
        );
        return reply.status(204).send();
      },
    );

    app.get(
      '/organizations/:orgId',
      { config: { ...access('org.read'), ...doc({ tag, summary: 'Get one organization.', params: orgParams, responseDto: 'OrganizationDto' }) } },
      async (request) => {
        const { orgId } = parseInput(orgParams, request.params);
        const org = await useCases.findOrganization.execute(OrgId.parse(orgId));
        if (!org) throw new NotFoundError('organization', orgId);
        return org;
      },
    );
  };
}
