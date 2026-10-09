# ADR-0025 — Org tự phục vụ: ai đăng nhập cũng tạo được org

**Trạng thái:** chấp nhận — 2026-10-09. Task: `docs/ews-tasks-rbac.csv` — GĐ 1.3 (chỉ phần tạo org).

## Bối cảnh

Sau ADR-0023 (app tự phục vụ) và ADR-0024 (tự tạo tài khoản M365), người mới vào được nhưng chưa
thuộc org nào — tạo org vẫn chỉ Super Admin làm được (`POST /admin/accounts/:id/organizations`).

## Quyết định

1. Quyền mới `org.create` — ai đăng nhập cũng có (như `self.read`), không cần thuộc org nào.
2. `POST /admin/organizations {name}` -> `CreateOwnOrganization`: tạo org trong account của CHÍNH
   người tạo và ghi người đó là **Owner** — cùng một transaction, nên không có org thiếu Owner.
   Audit: `OrganizationCreated` + `OrgMemberSet`.
3. Route cũ của Super Admin (chọn account, không thêm ai) giữ nguyên.
4. **Không làm** lúc này (CSV GĐ 1.3 có ghi): hạn mức số org, đổi tên / xoá org, chuyển Owner — làm
   khi có nhu cầu thật. Org rác Super Admin dọn bằng tay.

## Hệ quả

Luồng người mới không cần CLI: đăng nhập M365 -> tạo org (thành Owner) -> tạo app, lấy khoá.
