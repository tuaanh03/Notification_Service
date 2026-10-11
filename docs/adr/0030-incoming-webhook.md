# ADR-0030 — Incoming webhook: công cụ ngoài gọi vào một URL bí mật để phát tin vào topic

**Trạng thái:** chấp nhận — 2026-10-11.

## Bối cảnh

Phát vào topic (ADR-0028) cần API key và body đúng khuôn EWS. Công cụ ngoài — Gatus, script / dịch vụ
tự build của đội — chỉ biết POST JSON của CHÍNH nó tới một URL, có thể ở trong hoặc ngoài mạng nội bộ.
Người dùng chốt: thiết kế ánh xạ đường dẫn JSON (để công cụ giữ nguyên JSON của nó), và các con số vận
hành (khung chống trùng, giới hạn mỗi phút) phải do Super Admin chỉnh trên console, không cố định.

## Quyết định

1. **Module mới `incoming`.** Mỗi hook thuộc MỘT app, gắn cố định MỘT topic + MỘT template; URL
   `POST /hooks/:token` (bề mặt public, không API key). Token `ewshk_` + 32 byte ngẫu nhiên, chỉ lưu
   SHA-256 + đoạn gợi nhớ, hiện một lần lúc tạo / đổi URL. Token sai và hook tắt trả CÙNG 404.
2. **Ánh xạ đường dẫn JSON.** Mỗi biến `payload.*` của bản template đang xuất bản lấy giá trị theo thứ
   tự: dòng ánh xạ `path` (kèm mặc định tuỳ chọn) > dòng `fixed` (chữ cố định) > trường cùng tên ở tầng
   đầu của JSON. Cú pháp: `a.b`, `a[0]`, `a[-1]` (phần tử cuối), `a["khoá.có.chấm"]`; ≤ 10 tầng, ≤ 200 ký
   tự, ≤ 30 dòng; không ký tự đại diện, không biểu thức; không đi theo prototype. Sai cú pháp -> 422
   `WEBHOOK_PATH_INVALID` NGAY LÚC LƯU. Đổi giá trị: chữ / số / bool giữ; mảng chữ-số nối `", "`; null,
   chuỗi rỗng / toàn khoảng trắng (Gatus điền `""` cho chỗ trống), mảng rỗng = không có -> mặc định;
   object -> 422 `INVALID_PAYLOAD_VALUE`. Thiếu biến bắt buộc -> 422 `MISSING_VARIABLE` (từ template).
3. **Điều kiện phát** (tuỳ chọn): đường dẫn + danh sách giá trị chấp nhận (so theo dạng chữ). Không thoả
   -> 200 `{ status: 'skipped', reason: 'condition_not_met' }`, không gửi, không tính giới hạn.
4. **Chống trùng**: header `Idempotency-Key` > giá trị ở đường dẫn khoá đã khai > băm body (khoá object
   xếp thứ tự) + khung thời gian CỐ ĐỊNH (Cài đặt hệ thống). Khoá cuối `hook:<hookId>:<sha256>` đi vào
   `idempotencyKey` của `PublishToTopic` — trùng thì 200 `duplicate` kèm lần phát cũ. Khung cố định:
   hai lần gọi giống nhau nằm hai bên ranh giới khung vẫn thành hai lần phát — chấp nhận.
5. **Phát bằng đúng `PublishToTopic`** (ADR-0028): trần 100 người, topic bắt buộc phát được, worker và
   outgoing webhook (ADR-0029) không đổi. Actor `{ id: hookId, type: 'system' }`, nguồn audit mới
   `incoming_webhook`; `publications.created_by` = id hook.
6. **App phải gửi được + qua allowlist IP / Origin** — query công khai mới `apps/AuthorizeAppIngress`,
   cùng luật với `/v1`. Công cụ trong mạng nội bộ cũng gọi qua domain API (NPM), không gọi thẳng cổng
   4002 (README deploy: chỉ NPM được gọi vào cổng đó).
7. **Giới hạn mỗi hook** N lần phát / phút (Redis, `FixedWindowRateLimiter`, đếm chung mọi bản api);
   vượt -> 429 `INCOMING_HOOK_RATE_LIMITED`.
8. **Cài đặt hệ thống — module mới `settings`.** Bảng `system_settings` (khoá / giá trị JSON, chỉ dòng ĐÃ
   chỉnh); danh mục cố định trong code với mặc định + khoảng cho phép:
   `incoming.dedupe_window_minutes` (10, 1–1440) · `incoming.max_publications_per_minute` (20, 1–600) ·
   `api.public_base_url` (null, https://… — để console ghép URL đầy đủ của hook). `GET` / `PUT
   /admin/system-settings`, quyền `platform.manage` (chỉ Super Admin); kiểm HẾT rồi mới ghi; `null` = về
   mặc định; audit `SystemSettingsUpdated` có `before` / `after`. Đọc qua `SystemSettingsQueries.current()`
   có đệm 30 giây — process khác thấy giá trị mới tối đa sau 30 giây, không cần deploy / khởi động lại.
9. **Tối đa 10 hook mỗi app** bằng `slot` 1..10 + unique `(app_id, slot)` (cùng cách ADR-0029), test
   `race()` 12 lệnh -> đúng 10.
10. **Nhật ký gọi** `incoming_calls`: mọi lần gọi của hook có thật (cả bị từ chối) — thời điểm, mã HTTP,
    kết cục (`published` · `duplicate` · `skipped` · `rejected`), lần phát, số người nhận, mã lỗi. KHÔNG lưu
    body gốc. Job `purge-incoming-calls` (mỗi giờ) xoá dòng cũ hơn 30 ngày.
11. **Xem trước** `POST …/incoming-webhooks/preview`: chạy cấu hình (chưa cần lưu) trên JSON mẫu — điều
    kiện, nguồn khoá chống trùng, từng biến (nguồn, giá trị, dùng mặc định, thiếu), thư đã đổ biến
    (`user.external_id` = "preview"). Không ghi, không gửi, không tính giới hạn.
12. **Cảnh báo** trong danh sách hook: template chưa xuất bản / đã lưu trữ / không còn, topic không còn /
    không active, biến bắt buộc chưa ánh xạ (chỉ có giá trị nếu JSON có trường cùng tên ở tầng đầu), ánh
    xạ cho biến mà bản template hiện tại không khai.

## Không làm

- Chọn topic / template theo nội dung JSON (một hook = một topic cố định).
- Biểu thức, ký tự đại diện, ghép nhiều trường vào một biến.
- Danh sách IP nội bộ được phép riêng cho hook (dùng allowlist của app).
- Màn quản lý trên console (giai đoạn 2).

## Hệ quả

- Migration `0012_incoming_hooks_settings`: `incoming_hooks`, `incoming_calls`, `system_settings`.
- Cửa công khai mới: `templates/TemplateQueries.publishedVariables`, `apps/AuthorizeAppIngress`;
  `notifications.module` xuất `publishToTopic`; `shared/http` xuất `statusOfDomainError` (nhật ký ghi đúng
  mã HTTP công cụ nhận được).
- Tài liệu cho đội app: `huong-dan-tich-hop-cho-doi-app.md` mục 6, cách 3 (kèm mẫu cấu hình Gatus).
- Test: `test/unit/incoming-extraction.test.ts`, `test/integration/incoming-api.test.ts`.
