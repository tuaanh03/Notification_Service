import {
  AppId,
  decide,
  InvalidIdError,
  NotFoundError,
  PermissionDeniedError,
  type AccessTarget,
  type AdminAccess,
  type AdminId,
  type Permission,
} from '../../../../shared/kernel/index.ts';
import type { AdminAppRoleRepository, AppRepository, MembershipLookup } from '../ports/index.ts';

/** Đối tượng thô lấy từ request (`shared/http` RouteTarget, cùng hình dạng). */
export type AuthorizeTarget = { kind: 'app'; appId: string } | { kind: 'org'; orgId: string } | { kind: 'none' };

const SUPER_ADMIN: AdminAccess = { isSuperAdmin: true, orgRoles: new Map(), appRoles: new Map() };

/**
 * Lớp kiểm quyền của MỌI route `/admin/*` (ADR-0022): tra vai của người gọi, tra app -> org, rồi
 * hỏi luật thuần `decide()`. Nằm ở module apps vì apps đứng trên tenancy (apps -> tenancy một
 * chiều, ADR-0011) — thấy được cả vai org (qua tenancy) lẫn vai app và app -> org (của chính nó).
 *
 * Super Admin không tra gì. Người khác tốn 2 truy vấn (vai org, vai app) + 1 nếu đối tượng là app.
 * Không cache: thu quyền có hiệu lực ngay ở request kế tiếp.
 */
export class AuthorizeAdmin {
  private readonly deps: { apps: AppRepository; roles: AdminAppRoleRepository; memberships: MembershipLookup };

  constructor(deps: AuthorizeAdmin['deps']) {
    this.deps = deps;
  }

  async execute(input: {
    adminId: AdminId;
    isSuperAdmin: boolean;
    permission: Permission;
    target: AuthorizeTarget;
  }): Promise<AdminAccess> {
    if (input.isSuperAdmin) return SUPER_ADMIN;

    const [orgRoles, appRows] = await Promise.all([
      this.deps.memberships.rolesOf(input.adminId),
      this.deps.roles.listByAdmin(input.adminId),
    ]);
    const access: AdminAccess = { isSuperAdmin: false, orgRoles, appRoles: new Map(appRows.map((r) => [r.appId, r.role])) };
    const target = await this.resolve(input.target);

    const decision = decide(access, input.permission, target);
    // Người ngoài org nhận ĐÚNG lỗi như khi đối tượng không tồn tại — không dò được id của org khác.
    if (decision === 'hidden') throw notFound(input.target);
    if (decision === 'deny') throw new PermissionDeniedError('FORBIDDEN', `missing permission ${input.permission}`);
    return access;
  }

  private async resolve(target: AuthorizeTarget): Promise<AccessTarget> {
    if (target.kind === 'none') return null;
    if (target.kind === 'org') return { orgId: target.orgId };
    // Id sai định dạng = không tồn tại (404), không phải 422: người gọi chưa được phép biết gì thêm.
    const appId = parseAppId(target.appId);
    const app = appId === null ? null : await this.deps.apps.findById(appId);
    if (app === null) throw notFound(target);
    return { orgId: app.orgId, appId: app.id };
  }
}

function parseAppId(raw: string): AppId | null {
  try {
    return AppId.parse(raw);
  } catch (err) {
    if (err instanceof InvalidIdError) return null;
    throw err;
  }
}

function notFound(target: AuthorizeTarget): NotFoundError {
  if (target.kind === 'app') return new NotFoundError('app', target.appId);
  if (target.kind === 'org') return new NotFoundError('organization', target.orgId);
  return new NotFoundError('resource', '-');
}
