# ADR-0040 — Quản lý tổ chức: đổi tên, chuyển Owner, xoá

**Trạng thái:** chấp nhận — 2026-10-22. Bổ sung phần "Chưa làm" của ADR-0025.

## Quyết định

1. **Chỉ Owner (hoặc Super Admin)** đổi tên / chuyển Owner / xoá — Org Admin quản thành viên được nhưng không làm ba
   việc này (`OWNER_REQUIRED` 403). Route khai `org.manage`, lệnh tự kiểm vai Owner (cùng cách `SetOrgMember`).
2. **Đổi tên**: `PATCH /admin/organizations/:orgId` `{ name }`, 1–200 ký tự (`ORG_NAME_REQUIRED` / `ORG_NAME_TOO_LONG`),
   audit `OrganizationRenamed`.
3. **Chuyển Owner**: `POST …/transfer-owner` `{ adminId }` — người nhận phải đã là thành viên (`NOT_ORG_MEMBER`); người đó
   thành Owner, MỌI Owner cũ thành Org Admin (vẫn ở lại org). Khoá dòng org rồi đổi trong MỘT transaction — org không
   lúc nào thiếu Owner. Audit `OrgOwnerTransferred`.
4. **Xoá**: `DELETE …/:orgId` `{ confirmName }` — gõ lại đúng tên (`ORG_NAME_MISMATCH`), org KHÔNG còn app nào chưa thu
   hồi (`ORG_HAS_APPS` 409 — xoá dây chuyền là mất khoá API và lịch sử của app đang chạy; app đã thu hồi là trạng thái
   kết thúc nên không chặn). XOÁ MỀM (`organizations.deleted_at`, migration 0030): repository bỏ qua org đã xoá ở mọi
   truy vấn; gỡ mọi thành viên cùng transaction; audit `OrganizationDeleted`. Dòng giữ lại vì app đã thu hồi, audit… trỏ tới.
5. Lệnh xoá đặt ở module **apps** (`DeleteOrgWithoutApps`, chỉ apps đếm được app — apps -> tenancy một chiều); tenancy
   khoá dòng org rồi gọi `guard` của apps, nên tạo app song song không lọt qua chỗ đếm.

## Chưa làm

Hạn mức số org mỗi người · khôi phục org đã xoá (Super Admin làm tay trong DB nếu cần).
