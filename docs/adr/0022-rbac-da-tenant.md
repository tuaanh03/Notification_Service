# ADR-0022 — RBAC đa tenant cho bề mặt `/admin`

**Trạng thái:** chấp nhận — 2026-10-06. Thay phần "mọi admin đã đăng nhập thấy mọi thứ" của ADR-0019.
Task: `docs/ews-tasks-rbac.csv` (GĐ 1.1 + 1.2).

## 1. Cây vai trò

```
Account (bản cài EWS — ẩn, giữ cho composite FK của ADR-0011)
├── Super Admin            admins.role = 'super_admin' — vai hệ thống DUY NHẤT
└── Organization (tenant)  cô lập cứng: người ngoài nhận 404
    ├── Owner              org_members.role — org luôn còn ≥ 1
    ├── Org Admin
    ├── Member
    └── App
        ├── App Admin      admin_app_roles.role — chỉ cấp cho thành viên org
        └── App Viewer
```

Người không phải Super Admin có `admins.role = 'user'`; quyền của họ chỉ đến từ vai org / app.
Owner / Org Admin **ngầm** là App Admin trên mọi app của org — tính lúc kiểm, không lưu dòng.

## 2. Bảng quyền

| Quyền | Ai được |
| --- | --- |
| `platform.manage` — tạo account / org (tạm), audit ngoài phạm vi app | Super Admin |
| `app.review` — duyệt / từ chối / tạm ngưng / mở lại / thu hồi app | Super Admin |
| `org.read` | mọi thành viên org |
| `app.create` | Owner, Org Admin |
| `app.read` | Owner, Org Admin, App Admin / App Viewer của app đó |
| `app.manage` — topic (kể cả đặt / bỏ bắt buộc — bổ sung 2026-10-13), template, khoá API, gửi duyệt | Owner, Org Admin, App Admin của app đó |

Không phải thành viên org chứa đối tượng -> **404** (y như đối tượng không tồn tại, id sai định dạng
cũng 404). Là thành viên nhưng thiếu vai -> **403** `FORBIDDEN`.

## 3. Cài đặt

- **Luật là hàm thuần** `decide(access, permission, target)` ở `shared/kernel/access-policy.ts`. Ở
  kernel (không ở module) vì `shared/http` khai quyền theo kiểu `Permission`, còn module apps gọi luật.
- **Mỗi route `/admin` khai quyền** bằng `{ config: access('app.read') }`. Hook `onRoute` của bề mặt
  `/admin` ném lỗi khi khởi động nếu route nào thiếu — không route nào lọt vì quên.
- **Kiểm ở `preHandler`** (body đã parse — `POST /apps` lấy org từ body): đối tượng mặc định lấy từ
  `:appId`, rồi `:orgId`; route khác tự khai `target`.
- **Hiện thực ở module apps** (`AuthorizeAdmin`): apps đứng trên tenancy (ADR-0011), thấy được vai org
  (qua query công khai `FindOrgMemberships` của tenancy), vai app và app -> org của chính nó. Super
  Admin không tra gì; người khác 2–3 truy vấn mỗi request. Không cache — thu quyền có hiệu lực ngay.
- **Danh sách lọc trong route theo vai đã tra** (`GET /apps`: Member chỉ thấy app được cấp vai).
- **Ràng buộc ép ở command** (ADR-0009): "org còn ≥ 1 owner" khoá dòng `organizations` rồi mới đếm
  (`SetOrgMember`, có test `race()`); "vai app chỉ cho thành viên org" kiểm trong `GrantAppRole`.
- `org_members` có hai composite FK cùng mẫu ADR-0011: `fk_org_members_org_account`,
  `fk_org_members_admin_account`.

## 4. Chuyển dữ liệu (migration 0008)

Mọi admin đang có lúc chuyển -> `super_admin` (giữ nguyên quyền họ đang có). Vai `super_admin` cấp
app trong `admin_app_roles` bị bỏ (vô nghĩa). Đổi enum theo 3 bước mở rộng -> chuyển -> thu hẹp vì
MySQL strict mode từ chối thu hẹp khi còn giá trị cũ.

`admin-cli create-admin` bắt buộc `--role super_admin|user`. Gán người: `set-member`, `grant-app-role`.
Màn Thành viên trên console là task 1.5; tự tạo org là task 1.3.

## Bổ sung 2026-10-13 — topic bắt buộc do người quản lý app tự quyết

Bỏ quyền `topic.mandatory` (trước chỉ Super Admin). Đặt / bỏ bắt buộc nay thuộc `app.manage`: Owner,
Org Admin, App Admin của app — lúc tạo (`POST /admin/apps/:appId/topics` với `mandatory`) và **sau khi
tạo** (`PUT /admin/apps/:appId/topics/:key/mandatory` `{ mandatory }`, mới). Không đòi lý do, không
chờ duyệt; thay đổi vẫn vào audit (event `TopicMandatoryChanged`, `before` / `after` có `mandatory`).

Giữ nguyên:
- App service vẫn KHÔNG đặt được `mandatory` qua `/v1` (ADR-0016 D6 — bên gọi API không tự lách opt-out).
- Bỏ bắt buộc không xoá lựa chọn của người nhận: ai từng tắt quay về đúng lựa chọn cũ (dòng
  `user_topic_preferences` vẫn còn). Đặt lại đúng giá trị đang có -> không ghi, không event.
- Bắt buộc vẫn KHÔNG bỏ qua L0 (email đã ngắt / hỏng).
