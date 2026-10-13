# ADR-0023 — App tự phục vụ: bỏ bước duyệt app

**Trạng thái:** chấp nhận — 2026-10-09. Thay phần "duyệt app" của UC-001 và của ADR-0022 (quyền
`app.review` không còn dùng để duyệt app mới). Task: `docs/ews-tasks-rbac.csv` — GĐ 1.6 bỏ.

## Bối cảnh

Trước đây app đi `draft -> pending_approval -> (Super Admin duyệt) -> active`, lúc duyệt Super Admin
cấp kênh gửi và hạn mức, rồi mới cấp được khoá API. Hướng mới: đội app service tự tạo app, tự lấy
khoá API; Super Admin không duyệt, chỉ dọn app rác bằng tay.

Trong "quyền cấp lúc duyệt", chỉ **kênh** là thứ hệ thống thật sự kiểm lúc gửi (`App.assertChannel`
-> `CHANNEL_NOT_GRANTED`). Hạn mức của từng app (`rate_limit_per_minute`, `max_recipients_per_event`)
lưu nhưng chưa được đối chiếu ở đâu — ADR này không đụng tới chúng.

## Quyết định

1. **Tạo app là `active` ngay**, cấp sẵn kênh `email` (`SELF_SERVE_CHANNELS`). Luật nằm ở domain:
   `App.register()`; `CreateApp` gọi nó. Event `AppCreated` mang luôn `status` và `grantedChannels`
   trong `after`, nên audit vẫn trả lời được "app này được cấp gì, khi nào".
2. **Ai tạo được app: không đổi** — `app.create` (Owner, Org Admin, Super Admin).
3. **Khoá API: không đổi** — `app.manage` (Owner, Org Admin, App Admin) tự cấp / thu hồi.
4. **Tạm ngưng / mở lại / thu hồi: không đổi** — vẫn `app.review`, chỉ Super Admin. Đây là công cụ
   dọn app rác.
5. **App cũ** đang `draft` / `pending_approval`: để nguyên, không migration. Máy trạng thái giữ
   `submit_for_review`, `approve`, `reject` cho riêng chúng; Super Admin tự duyệt hoặc thu hồi.
6. `/v1` không đổi: app bị tạm ngưng / thu hồi vẫn nhận `APP_NOT_ACTIVE` như cũ.

## Hệ quả

- Không còn hàng chờ duyệt (task GĐ 1.6 bỏ). Console bỏ màn "chờ duyệt" và chuông chờ duyệt.
- Rủi ro app rác / app gửi bừa: Super Admin xử lý bằng tạm ngưng / thu hồi; lớp chặn cuối vẫn là
  giới hạn gửi chung `EMAIL_MAX_PER_MINUTE`.
- Test không dựng được app `pending_approval` qua API nữa — test của app cũ sửa thẳng dòng trong DB.

## Bổ sung (2026-10-12): giới hạn IP do Super Admin quản lý, bỏ Origin

7. **Giới hạn IP của app** (`/admin/apps/:appId/network-rules`) chuyển từ `app.read` / `app.manage` sang
   `platform.manage` — chỉ Super Admin xem / thêm / gỡ. Đội app muốn giới hạn thì báo Super Admin. Luật
   chặn không đổi: đã khai ít nhất một IP thì IP khác nhận 403 `IP_NOT_ALLOWED` ở `/v1` và `/hooks`.
8. **Bỏ luật Origin.** Header `Origin` chỉ trình duyệt gửi, request không có Origin vốn được cho qua, còn
   API key bắt buộc nằm ở server của app — luật này chỉ chặn được trường hợp đã bị cấm, ai cầm khoá bỏ
   header là qua. `NETWORK_RULE_KINDS` chỉ còn `ip`; migration `0016` xoá dòng `origin` cũ rồi thu enum;
   mã `ORIGIN_NOT_ALLOWED` không còn (hai tài liệu tích hợp + `lib/api/v1-errors.ts` của console đã sửa).
9. Console: bỏ màn "IP & Origin" của Cài đặt App và hai ô IP / Origin ở bước tạo app; Super Admin quản lý ở
   Quản trị EWS → Tất cả app → "Giới hạn IP".

## Bổ sung (2026-10-13): số khoá API theo cài đặt hệ thống, tên khoá, dùng lần cuối

10. **Bỏ trần cứng 2 khoá active.** Một app thường có nhiều nơi gọi `/v1`; mỗi nơi một khoá thì lộ khoá nào
    thu hồi đúng khoá đó. Trần nay là cài đặt hệ thống `apps.max_active_api_keys` (mặc định 20, cho phép
    1–100, chỉ Super Admin chỉnh). Vẫn giữ trần để khoá bỏ quên không tích tụ. Cách ép không đổi (ADR-0009):
    khoá dòng `apps` rồi mới đếm; vượt -> 422 `ACTIVE_SECRET_LIMIT`.
11. **Tên khoá** (`app_secrets.name`, ≤ 100 ký tự, tuỳ chọn ở API — console bắt buộc nhập). Khoá cũ và khoá
    đầu tiên cấp từ wizard có tên `null`.
12. **Dùng lần cuối** (`app_secrets.last_used_at`): `AuthenticateApiKey` ghi sau khi khoá đúng, chỉ khi lần
    ghi trước cũ hơn 5 phút (một UPDATE có điều kiện) — request `/v1` không thành lệnh ghi DB mỗi lần. Ghi
    hỏng chỉ log cảnh báo, không làm hỏng request. Migration `0017`.
