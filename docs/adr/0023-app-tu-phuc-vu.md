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
