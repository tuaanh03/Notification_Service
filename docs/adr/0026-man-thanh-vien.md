# ADR-0026 — Màn Thành viên: Owner / Org Admin tự quản lý người trong org

**Trạng thái:** chấp nhận — 2026-10-09. Task: `docs/ews-tasks-rbac.csv` — GĐ 1.5.

## Bối cảnh

Thêm người vào org và cấp vai app chỉ làm được bằng `admin-cli` (`set-member`, `grant-app-role`).
Sau ADR-0024 / ADR-0025 người mới tự vào và tự tạo org được, nên đây là chỗ cuối còn cần CLI.

## Quyết định

1. Quyền mới **`org.manage`** — Owner, Org Admin (Super Admin luôn được). Member: 403, người ngoài: 404.
2. Route (bề mặt `/admin`):

   | Route | Quyền | Module |
   | --- | --- | --- |
   | `GET /organizations/:orgId/members` | `org.read` | tenancy |
   | `PUT /organizations/:orgId/members` `{email, role}` | `org.manage` | tenancy (`SetOrgMember`) |
   | `DELETE /organizations/:orgId/members/:adminId` | `org.manage` | apps (`RemoveMemberFromOrg`) |
   | `GET /organizations/:orgId/app-roles` | `org.read` | apps |
   | `PUT /apps/:appId/roles` `{email, role}` | `org.manage` | apps (`GrantAppRole`) |
   | `DELETE /apps/:appId/roles/:adminId` | `org.manage` | apps (`RevokeAppRole`) |

3. **Chỉ Owner (hoặc Super Admin) động được vai Owner** — trao, hạ, gỡ (`assertMayTouchOwner`, 403
   `OWNER_REQUIRED`). Không có luật này thì Org Admin tự nâng mình lên Owner rồi gỡ Owner thật.
   `admin-cli` là lệnh hệ thống, không kiểm. Org vẫn luôn còn ≥ 1 Owner (409 `LAST_OWNER`).
4. Thêm người chỉ được người **đã có tài khoản** (đăng nhập M365 một lần — ADR-0024). Email chưa có
   -> 422 `ADMIN_NOT_REGISTERED` (path `email`). Không gửi thư mời — chưa làm.
5. **Gỡ khỏi org thu hồi luôn vai app** của người đó trên các app của org, CÙNG transaction. Lệnh đặt
   ở module apps (apps -> tenancy một chiều): gọi `RemoveOrgMember` của tenancy qua port
   `OrgMemberRemoval`, rồi thu hồi trên `admin_app_roles`. Không thu hồi thì thêm người đó vào lại
   là quyền cũ tự sống lại mà không ai cấp.
6. Audit: `OrgMemberSet`, `OrgMemberRemoved`, `AdminAppRoleGranted`, `AdminAppRoleRevoked`.

## Hệ quả

`set-member` / `grant-app-role` của `admin-cli` vẫn dùng được (cứu hộ khi org mất quyền quản lý).
