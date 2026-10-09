import { OrgId, type AdminAccess, type AdminId, type AppRole, type OrgRole } from '../../../../shared/kernel/index.ts';
import type { MembershipLookup, OrganizationLookup } from '../ports/index.ts';

/** Những gì người đang đăng nhập được thấy — console dựng ô chọn app và ẩn / hiện nút theo đây. */
export interface AdminProfileDto {
  isSuperAdmin: boolean;
  /**
   * Super Admin: mọi org; `role` là vai THÀNH VIÊN thật (null nếu không thuộc org đó) — console tách
   * khu Quản trị EWS (mọi org) khỏi console app (chỉ org mình là thành viên). Người khác: org mình là thành viên.
   */
  orgs: { id: string; name: string; role: OrgRole | null }[];
  /** Vai được cấp TRỰC TIẾP trên app. Owner / Org Admin còn có quyền ngầm trên mọi app của org. */
  appRoles: Record<string, AppRole>;
}

/**
 * `GET /admin/me` (ADR-0022). Nhận vai đã tra sẵn ở bước kiểm quyền (`adminAccess`) — không tra
 * lại; chỉ thêm tên org (một truy vấn theo lô). Riêng Super Admin: bước kiểm quyền KHÔNG tra vai org
 * (luôn allow), nên tra ở đây — một truy vấn, chỉ ở route này.
 */
export class GetAdminProfile {
  private readonly deps: { organizations: OrganizationLookup; memberships: MembershipLookup };

  constructor(deps: GetAdminProfile['deps']) {
    this.deps = deps;
  }

  async execute(input: { adminId: AdminId; access: AdminAccess }): Promise<AdminProfileDto> {
    const { access } = input;
    const ids = access.isSuperAdmin ? undefined : [...access.orgRoles.keys()].map((id) => OrgId.parse(id));
    const [orgs, orgRoles] = await Promise.all([
      this.deps.organizations.list(ids),
      access.isSuperAdmin ? this.deps.memberships.rolesOf(input.adminId) : Promise.resolve(access.orgRoles),
    ]);
    return {
      isSuperAdmin: access.isSuperAdmin,
      orgs: orgs.map((o) => ({ ...o, role: orgRoles.get(o.id) ?? null })),
      appRoles: Object.fromEntries(access.appRoles),
    };
  }
}
