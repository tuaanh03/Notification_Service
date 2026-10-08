import { OrgId, type AdminAccess, type AppRole, type OrgRole } from '../../../../shared/kernel/index.ts';
import type { OrganizationLookup } from '../ports/index.ts';

/** Những gì người đang đăng nhập được thấy — console dựng ô chọn app và ẩn / hiện nút theo đây. */
export interface AdminProfileDto {
  isSuperAdmin: boolean;
  /** Super Admin: mọi org, `role: null`. Người khác: org mình là thành viên. */
  orgs: { id: string; name: string; role: OrgRole | null }[];
  /** Vai được cấp TRỰC TIẾP trên app. Owner / Org Admin còn có quyền ngầm trên mọi app của org. */
  appRoles: Record<string, AppRole>;
}

/**
 * `GET /admin/me` (ADR-0022). Nhận vai đã tra sẵn ở bước kiểm quyền (`adminAccess`) — không tra
 * lại; chỉ thêm tên org (một truy vấn theo lô).
 */
export class GetAdminProfile {
  private readonly deps: { organizations: OrganizationLookup };

  constructor(deps: GetAdminProfile['deps']) {
    this.deps = deps;
  }

  async execute(access: AdminAccess): Promise<AdminProfileDto> {
    const ids = access.isSuperAdmin ? undefined : [...access.orgRoles.keys()].map((id) => OrgId.parse(id));
    const orgs = await this.deps.organizations.list(ids);
    return {
      isSuperAdmin: access.isSuperAdmin,
      orgs: orgs.map((o) => ({ ...o, role: access.orgRoles.get(o.id) ?? null })),
      appRoles: Object.fromEntries(access.appRoles),
    };
  }
}
