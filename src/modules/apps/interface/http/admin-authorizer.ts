import type { AdminAuthorizer, AdminCaller, RouteTarget } from '../../../../shared/http/index.ts';
import { AdminId, type AdminAccess, type Permission } from '../../../../shared/kernel/index.ts';
import type { AuthorizeAdmin } from '../../application/index.ts';

/** Cổng kiểm quyền cho TOÀN BỘ bề mặt `/admin` — của mọi module (ADR-0022). */
export class AppsAdminAuthorizer implements AdminAuthorizer {
  private readonly authorizeAdmin: AuthorizeAdmin;

  constructor(deps: { authorizeAdmin: AuthorizeAdmin }) {
    this.authorizeAdmin = deps.authorizeAdmin;
  }

  authorize(input: { caller: AdminCaller; permission: Permission; target: RouteTarget }): Promise<AdminAccess> {
    return this.authorizeAdmin.execute({
      adminId: AdminId.parse(input.caller.adminId),
      isSuperAdmin: input.caller.role === 'super_admin',
      permission: input.permission,
      target: input.target,
    });
  }
}
