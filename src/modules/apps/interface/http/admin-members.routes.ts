import { z } from 'zod';
import type { CommandContext } from '../../../../shared/application/index.ts';
import { access, adminAccess, adminCaller, parseInput, type HttpRoutes } from '../../../../shared/http/index.ts';
import { AdminId, AppId, APP_ROLES, OrgId } from '../../../../shared/kernel/index.ts';
import type { GrantAppRole, ListOrgAppRoles, RemoveMemberFromOrg, RevokeAppRole } from '../../application/index.ts';

const orgParams = z.object({ orgId: z.string().uuid() });
const memberParams = z.object({ orgId: z.string().uuid(), adminId: z.string().uuid() });
const appParams = z.object({ appId: z.string().uuid() });
const appRoleParams = z.object({ appId: z.string().uuid(), adminId: z.string().uuid() });
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
}): HttpRoutes {
  return (app) => {
    const ctx = (request: Parameters<typeof adminCaller>[0]): CommandContext => ({
      actor: { id: adminCaller(request).adminId, type: 'admin' },
      source: 'admin_api',
    });

    app.get('/organizations/:orgId/app-roles', { config: access('org.read') }, async (request) => {
      const { orgId } = parseInput(orgParams, request.params);
      return useCases.listOrgAppRoles.execute(OrgId.parse(orgId));
    });

    app.delete('/organizations/:orgId/members/:adminId', { config: access('org.manage') }, async (request, reply) => {
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
    });

    app.put('/apps/:appId/roles', { config: access('org.manage') }, async (request) => {
      const { appId } = parseInput(appParams, request.params);
      const body = parseInput(grantBody, request.body);
      return useCases.grantAppRole.execute({ appId: AppId.parse(appId), email: body.email, role: body.role }, ctx(request));
    });

    app.delete('/apps/:appId/roles/:adminId', { config: access('org.manage') }, async (request, reply) => {
      const { appId, adminId } = parseInput(appRoleParams, request.params);
      await useCases.revokeAppRole.execute({ appId: AppId.parse(appId), adminId: AdminId.parse(adminId) }, ctx(request));
      return reply.status(204).send();
    });
  };
}
