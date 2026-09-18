# ADR-0015 — Lát cắt dọc `apps`: cách module cắm vào process, API key, admin tạm thời

**Trạng thái:** chấp nhận — 2026-09-18.

## 1. Module cắm vào process qua `ModuleDefinition` — process không biết module nào tồn tại

```
modules/<x>/interface/http/*.routes.ts   -> factory(useCases) => HttpRoutes
modules/<x>/interface/consumers/*.ts     -> factory(useCases) => MessageHandler
composition/modules/<x>.module.ts        -> dựng adapter -> use case -> route/handler, trả ModuleDefinition
composition/application.ts               -> buildApplication(): danh sách module + authenticators
entrypoints/api/main.ts        -> startApi(container, application)        đọc httpSurfaces(application)
entrypoints/worker/main.ts     -> startWorker(container, consumerRegistry(application))
entrypoints/scheduler/main.ts  -> startScheduler(container, moduleJobs(application))
```

`ModuleDefinition = { name, http?: { public?, admin?, v1? }, consumers?, jobs? }`. Thêm module mới =
một file trong `composition/modules/` + một dòng trong `buildApplication`. Route khai path TƯƠNG ĐỐI
với bề mặt (`/apps`, không phải `/admin/apps`).

## 2. Ba bề mặt HTTP, xác thực do server lo — route không tự kiểm credential

| Bề mặt | Prefix | Xác thực | Hiện thực |
| --- | --- | --- | --- |
| public | — | không | health |
| admin | `/admin` | `AdminAuthenticator` | `BootstrapAdminAuthenticator` (tạm, mục 4) |
| v1 | `/v1` | `ApiKeyAuthenticator` | module apps: `AuthenticateApiKey` + allowlist IP/Origin |

Hợp đồng (`AppCaller`, `AdminCaller`, hai interface authenticator) nằm ở `shared/http`, KHÔNG ở module
apps: route `/v1/*` của notifications sau này đọc `appCaller(request)` mà không import apps. Hook xác
thực chạy ở `onRequest` của từng scope Fastify — trước khi parse body.

## 3. API key: `ews_<secret id 32 hex>_<256 bit base64url>`, lưu `sha256:<hex>`

- Secret id nằm trong key -> tra đúng một dòng theo khoá chính.
- **SHA-256, không argon2** (lệch tài liệu kiến trúc §13): argon2 làm chậm việc dò mật khẩu entropy
  thấp. Key 256 bit ngẫu nhiên không dò được dù hash nhanh, còn argon2 tốn ~50 ms CPU mỗi request `/v1`.
- Mọi kiểu key sai trả cùng `INVALID_API_KEY` (401). 403 (`APP_NOT_ACTIVE`, `IP_NOT_ALLOWED`,
  `ORIGIN_NOT_ALLOWED`) chỉ sau khi key đúng.
- Plaintext chỉ nằm trong response tạo key (`cache-control: no-store`); không vào DB, event, audit, log.
- "≤ 2 key active": khoá dòng `apps` rồi mới đếm (ADR-0009); có test 5 request HTTP song song.

## 4. `/admin/*` tạm thời dùng MỘT token từ env `ADMIN_TOKEN`

Chưa có đăng nhập admin + RBAC (`admins`, `admin_app_roles`). Để lát cắt apps dùng được mà không mở
toang `/admin`: một bootstrap token (≥ 32 ký tự, so sánh thời gian hằng số), actor audit là
`bootstrap-admin`. Không đặt `ADMIN_TOKEN` -> `/admin/*` trả 401 `ADMIN_AUTH_DISABLED` (đóng mặc định).
**Thay bằng session + RBAC trước khi mở cho người ngoài** — chỉ cần hiện thực `AdminAuthenticator` mới,
route không đổi.

## 5. Module hỏi module qua query công khai
apps cần biết org thuộc account nào: port `OrganizationLookup` (apps) -> adapter `TenancyOrganizationLookup`
-> `FindOrganization` (tầng application của tenancy). Không query bảng `organizations`.

## 6. Audit là consumer đầu tiên
Command ghi event với payload `AuditedPayload` (`actor`, `source`, `before`, `after`) -> outbox ->
`audit.events` -> consumer group `audit-writer` -> `audit_log`. Module phát event không biết audit tồn tại.

## 7. Các sửa lỗi phát hiện khi chạy thật
- POST không body kèm `Content-Type: application/json` bị Fastify trả 400 -> parser JSON riêng: body rỗng
  = không có body; JSON hỏng = 400 `MALFORMED_JSON`.
- `ADMIN_TOKEN=` rỗng (từ `${ADMIN_TOKEN:-}` của compose) làm cả 3 process không khởi động được -> rỗng
  = không cấu hình.
