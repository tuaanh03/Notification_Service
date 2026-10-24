import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminAccess, adminCaller, adminContext, doc, type HttpRoutes, parseInput } from '../../../../shared/http/index.ts';
import { AdminId, AppId, APP_ROLES, OrgId } from '../../../../shared/kernel/index.ts';
import type { DeleteOrgWithoutApps, GrantAppRole, ListOrgAppRoles, RemoveMemberFromOrg, RevokeAppRole } from '../../application/index.ts';

const orgParams = z.object({ orgId: z.string().uuid() });
const memberParams = z.object({ orgId: z.string().uuid(), adminId: z.string().uuid() });
const appParams = z.object({ appId: z.string().uuid() });
const appRoleParams = z.object({ appId: z.string().uuid(), adminId: z.string().uuid() });
const deleteOrgBody = z.object({ confirmName: z.string().max(200) }).strict();
const grantBody = z.object({ email: z.string().trim().min(3).max(320), role: z.enum(APP_ROLES) }).strict();

/**
 * Phần của màn Thành viên nằm ở module apps (ADR-0026): vai app, và gỡ thành viên (kèm thu hồi vai
 * app trong cùng transaction). Thêm / đổi vai org và danh sách thành viên ở `tenancy`.
 */
export function adminMembersRoutes(useCases: {
  listOrgAppRoles: ListOrgAppRoles;
  removeMemberFromOrg: RemoveMemberFromOrg;
  grantAppRole: GrantAppRole;
  revokeAppRole: RevokeAppRole;
  deleteOrg: DeleteOrgWithoutApps;
}): HttpRoutes {
  return (app) => {
    // Nguồn audit theo cách xác thực: phiên -> `admin_api`, PAT -> `admin_pat` (ADR-0044).
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => adminContext(request);

    // Chỉ Owner (hoặc Super Admin) đụng được Owner / xoá được org.
    const ownerErrors = [{ status: 403, code: 'OWNER_REQUIRED' }];

    app.get(
      '/organizations/:orgId/app-roles',
      {
        config: {
          ...access('org.read'),
          ...doc({
            tag: 'organizations',
            summary: 'List the app roles granted to members of an organization.',
            description: 'Only direct app roles. Owners and Org Admins also act on every app of the organization without one.',
            params: orgParams,
            responseDto: "{ adminId: string; appId: string; role: 'app_admin' | 'app_viewer' }[]",
          }),
        },
      },
      async (request) => {
        const { orgId } = parseInput(orgParams, request.params);
        return useCases.listOrgAppRoles.execute(OrgId.parse(orgId));
      },
    );

    app.delete(
      '/organizations/:orgId/members/:adminId',
      {
        config: {
          ...access('org.manage'),
          ...doc({
            tag: 'organizations',
            summary: 'Remove a member from an organization, together with all their app roles in it.',
            description: 'Only an Owner (or Super Admin) can remove an Owner; the last Owner cannot be removed.',
            params: memberParams,
            status: 204,
            errors: [...ownerErrors, { status: 409, code: 'LAST_OWNER' }],
          }),
        },
      },
      async (request, reply) => {
        const { orgId, adminId } = parseInput(memberParams, request.params);
        const caller = adminAccess(request);
        await useCases.removeMemberFromOrg.execute(
          {
            orgId: OrgId.parse(orgId),
            adminId: AdminId.parse(adminId),
            actorIsOwner: caller.isSuperAdmin || caller.orgRoles.get(orgId) === 'owner',
          },
          ctx(request),
        );
        return reply.status(204).send();
      },
    );

    // Xoá tổ chức (2C): Owner / Super Admin, gõ lại tên, không còn app đang dùng được. Ở module apps vì phải đếm app.
    app.delete(
      '/organizations/:orgId',
      {
        config: {
          ...access('org.manage'),
          ...doc({
            tag: 'organizations',
            summary: 'Delete an organization.',
            description:
              'Owner or Super Admin only. `confirmName` must be the exact organization name. Refused while the organization still has an app that is not revoked. All members are removed.',
            params: orgParams,
            body: deleteOrgBody,
            example: { confirmName: 'HR Department' },
            status: 204,
            errors: [...ownerErrors, { status: 409, code: 'ORG_HAS_APPS' }, { status: 422, code: 'ORG_NAME_MISMATCH' }],
          }),
        },
      },
      async (request, reply) => {
        const { orgId } = parseInput(orgParams, request.params);
        const body = parseInput(deleteOrgBody, request.body);
        const caller = adminAccess(request);
        await useCases.deleteOrg.execute(
          { orgId: OrgId.parse(orgId), confirmName: body.confirmName, actorIsOwner: caller.isSuperAdmin || caller.orgRoles.get(orgId) === 'owner' },
          ctx(request),
        );
        return reply.status(204).send();
      },
    );

    app.put(
      '/apps/:appId/roles',
      {
        config: {
          ...access('org.manage'),
          ...doc({
            tag: 'organizations',
            summary: 'Grant or change the role of a person on an app (App Admin or App Viewer).',
            description: 'The person must already have an EWS account and be a member of the organization that owns the app.',
            params: appParams,
            body: grantBody,
            example: { email: 'an.nguyen@example.com', role: 'app_admin' },
            responseDto: "{ appId: string; adminId: string; email: string; role: 'app_admin' | 'app_viewer' }",
            errors: [
              { status: 409, code: 'NOT_ORG_MEMBER' },
              { status: 422, code: 'ADMIN_NOT_REGISTERED' },
            ],
          }),
        },
      },
      async (request) => {
        const { appId } = parseInput(appParams, request.params);
        const body = parseInput(grantBody, request.body);
        return useCases.grantAppRole.execute({ appId: AppId.parse(appId), email: body.email, role: body.role }, ctx(request));
      },
    );

    app.delete(
      '/apps/:appId/roles/:adminId',
      {
        config: {
          ...access('org.manage'),
          ...doc({ tag: 'organizations', summary: 'Revoke the role of a person on an app.', params: appRoleParams, status: 204 }),
        },
      },
      async (request, reply) => {
        const { appId, adminId } = parseInput(appRoleParams, request.params);
        await useCases.revokeAppRole.execute({ appId: AppId.parse(appId), adminId: AdminId.parse(adminId) }, ctx(request));
        return reply.status(204).send();
      },
    );
  };
}
