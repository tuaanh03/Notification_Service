# ADR-0011 — Composite FK chống cấp quyền chéo account

**Trạng thái:** chấp nhận — 2026-09-18. Migration: `drizzle/0001_rbac_account_fk.sql`.

## Bối cảnh
`admin_app_roles` là RBAC thật: admin chỉ chạm được app có dòng ở đây. Ở phase 0 bảng này có
hai lỗ:

1. `admin_app_roles.app_id` **không có FK** — grant được quyền vào một app không tồn tại.
2. Không gì ngăn admin của account X được cấp quyền vào app của account Y. `admins` thuộc
   account, `apps` thuộc org, org thuộc account — nhưng không có ràng buộc nào nối hai nhánh.

Cùng lúc, `uq_organizations_org_account` có comment "composite FK ở tầng dưới cần đúng index này",
trong khi **không có FK nào dùng nó**.

Đây là cùng loại lỗ mà `fk_users_app_org` / `fk_users_person_org` đã chặn ở tầng dữ liệu người
dùng (chéo org), chỉ khác là ở tầng quyền (chéo account).

## Quyết định
Ép ở DB bằng composite FK, cùng cơ chế với `users`:

| Ràng buộc | Đích (unique bắt buộc) | Chặn điều gì |
| --- | --- | --- |
| `fk_apps_org_account`: `apps(org_id, account_id)` | `uq_organizations_org_account` | `apps.account_id` phải đúng là account sở hữu org |
| `fk_admin_app_roles_admin_account`: `admin_app_roles(admin_id, account_id)` | `uq_admins_admin_account` | account của dòng grant phải là account của admin |
| `fk_admin_app_roles_app_account`: `admin_app_roles(app_id, account_id)` | `uq_apps_app_account` | …và cũng là account của app; kiêm luôn FK `app_id -> apps` |

Hai FK trên `admin_app_roles` cùng dùng một cột `account_id` nên admin và app buộc phải cùng account.
`apps.account_id` và `admin_app_roles.account_id` là cột denormalize, không mang nghĩa nghiệp vụ mới.

Domain chặn trước: `AdminAppRole.grant()` ném `CrossAccountViolationError` — để lỗi lộ ra ở unit
test, FK chỉ là chốt cuối.

## Hệ quả
- Ba unique index `uq_organizations_org_account`, `uq_admins_admin_account`, `uq_apps_app_account`
  là **bắt buộc**. InnoDB cho phép FK trỏ tới index không unique, nên xoá chúng thì ràng buộc
  âm thầm yếu đi mà không báo lỗi (xem ADR-0002 — Rủi ro còn lại).
- `tenancy/infrastructure/db/schema.ts` và `apps/infrastructure/db/schema.ts` import vòng lẫn nhau.
  An toàn vì Drizzle chỉ đọc tham chiếu FK một cách lazy; đã kiểm với cả hai thứ tự import.
- Cột mới là `NOT NULL` không default. Migration chạy được vì chưa có dữ liệu thật; nếu sau này
  cần áp lên DB đã có dữ liệu thì phải tách thành thêm cột nullable → backfill → đổi NOT NULL.
