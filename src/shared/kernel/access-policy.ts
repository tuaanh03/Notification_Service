import type { OrgRole, AppRole } from './enums.ts';

/**
 * Luật phân quyền của bề mặt `/admin` (ADR-0022) — hàm THUẦN, test được không cần DB.
 *
 * Đặt ở kernel (không ở một module) vì hai phía cùng cần: `shared/http` khai quyền trên từng route,
 * module `apps` (nơi hiện thực lớp kiểm quyền) gọi `decide()`. Sửa ở đây là sửa quyền cả hệ thống.
 *
 * Quyền KẾ THỪA được tính lúc kiểm, không lưu thành dòng: Owner / Org Admin tự có quyền App Admin
 * trên mọi app của org mình.
 */
export const PERMISSIONS = [
  /** Xem vai của CHÍNH MÌNH (`GET /admin/me`) — ai đăng nhập cũng có. */
  'self.read',
  /** Tạo org mới, người tạo thành Owner (ADR-0025) — ai đăng nhập cũng có. */
  'org.create',
  /** Đọc danh mục dùng chung, không thuộc org nào — thư viện mẫu template (ADR-0035). Ai đăng nhập cũng có. */
  'catalog.read',
  /** Việc của Super Admin: tạo account / org (tạm thời), xem audit ngoài phạm vi app. */
  'platform.manage',
  /** Xem một org mà mình là thành viên. */
  'org.read',
  /** Quản lý thành viên org và vai app trong org — Owner, Org Admin (ADR-0026). */
  'org.manage',
  /** Tạo app trong org. */
  'app.create',
  /** Xem dữ liệu của một app. */
  'app.read',
  /** Cấu hình app: topic (kể cả đặt / bỏ bắt buộc), template, khoá API, gửi duyệt. */
  'app.manage',
  /** Duyệt / từ chối / tạm ngưng / mở lại / thu hồi app — chỉ Super Admin. */
  'app.review',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Mọi vai của MỘT admin, đã tra sẵn. Super Admin không cần tra — luôn được phép. */
export interface AdminAccess {
  isSuperAdmin: boolean;
  orgRoles: ReadonlyMap<string, OrgRole>;
  appRoles: ReadonlyMap<string, AppRole>;
}

/** Đối tượng đang bị thao tác. `null` = việc cấp hệ thống, không thuộc org nào. */
export type AccessTarget = { orgId: string; appId?: string | undefined } | null;

/**
 * - `allow`  — được làm.
 * - `hidden` — không phải thành viên org chứa đối tượng: trả 404, không xác nhận nó tồn tại.
 * - `deny`   — là thành viên nhưng thiếu vai: trả 403.
 */
export type AccessDecision = 'allow' | 'hidden' | 'deny';

const SUPER_ADMIN_ONLY: ReadonlySet<Permission> = new Set(['platform.manage', 'app.review']);
const ORG_MANAGERS: ReadonlySet<OrgRole> = new Set(['owner', 'org_admin']);

export function decide(access: AdminAccess, permission: Permission, target: AccessTarget): AccessDecision {
  if (access.isSuperAdmin || permission === 'self.read' || permission === 'org.create' || permission === 'catalog.read') return 'allow';
  if (target === null) return 'deny';

  const orgRole = access.orgRoles.get(target.orgId);
  if (orgRole === undefined) return 'hidden';
  if (SUPER_ADMIN_ONLY.has(permission)) return 'deny';

  const managesOrg = ORG_MANAGERS.has(orgRole);
  // Vai app chỉ có nghĩa khi người đó còn là thành viên org (đã kiểm ở trên).
  const appRole = target.appId === undefined ? undefined : access.appRoles.get(target.appId);
  switch (permission) {
    case 'org.read':
      return 'allow';
    case 'org.manage':
      return managesOrg ? 'allow' : 'deny';
    case 'app.create':
      return managesOrg ? 'allow' : 'deny';
    case 'app.read':
      return managesOrg || appRole !== undefined ? 'allow' : 'deny';
    case 'app.manage':
      return managesOrg || appRole === 'app_admin' ? 'allow' : 'deny';
  }
  return 'deny';
}
