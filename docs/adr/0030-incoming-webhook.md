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

## Bổ sung — 2026-10-11: lấy lại URL bất cứ lúc nào, console tối giản

Người dùng chốt: người tạo webhook tự chịu trách nhiệm cho URL của mình (theo dõi bằng audit), nên phải
sao chép lại được URL bất cứ lúc nào; console chỉ hỏi hai câu nghiệp vụ (topic, template).

1. **Token không lưu, tính lại được** — `ewshk_` + HMAC-SHA256(`WEBHOOK_SIGNING_KEY`,
   `"incoming-hook-token:<hookId>:<token_version>"`) base64url. DB chỉ có băm (tra lời gọi vào) + đoạn gợi
   nhớ + cột mới `token_version` (migration `0013`). Đổi URL = `token_version + 1`. Thay §1 (token ngẫu nhiên).
2. **Phụ thuộc khoá ký của outgoing** (ADR-0029): thiếu khoá -> tạo / đổi / lấy URL trả 503
   `WEBHOOK_NOT_CONFIGURED`, danh sách trả `configured: false`. Đổi khoá = mọi URL incoming đổi theo — đúng ý:
   lộ khoá là lộ mọi URL. Chuỗi đầu vào khác secret outgoing nên hai thứ không trùng.
3. **`GET /admin/apps/:appId/incoming-webhooks/:hookId/url`** (`app.manage`, `no-store`) trả URL; mỗi lần lấy
   ghi audit `IncomingHookUrlRevealed`. App Viewer 403. Hook có băm không khớp token tính lại (tạo trước bổ
   sung này) -> 409 `INCOMING_URL_NEEDS_ROTATION`, đổi URL là lấy được. Production lúc bổ sung có 0 hook.
4. **Console**: không hộp thoại — thêm / sửa (topic, template) ngay trong danh sách, nút Sao chép URL / Đổi URL
   / Tắt / Xoá, mục "Body mẫu" (khuôn chuẩn: trường trùng tên biến) và "Nhật ký" đóng sẵn. Ánh xạ đường dẫn,
   khoá chống trùng, điều kiện phát KHÔNG có trên console — chỉ qua API cho trường hợp đặc biệt.

## Bổ sung — 2026-10-11: lỗi nói theo trường của body, không lộ token

5. **Token không ra log / lỗi**: `redactUrl` (`shared/http`) thay `/hooks/<token>` bằng `/hooks/ewshk_xxxx…yyyy`
   ở log mỗi request, `instance` và câu 404. Bản trước ghi nguyên URL vào log server.
6. **Lỗi theo tên trường người gọi gửi**: `/hooks/*` kiểm biến bắt buộc TRƯỚC template (`missingRequiredIssues`),
   báo `field "service" is required but missing` (`path` = tên trường, hoặc đường dẫn đã ánh xạ) thay vì
   `payload.service`; trường sai kiểu chỉ báo một lỗi `INVALID_PAYLOAD_VALUE`. Mã lỗi giữ nguyên.
7. **Nhật ký có tên trường**: cột `incoming_calls.error_fields` (JSON, migration `0014`) — chỉ tên trường của lỗi
   thiếu / sai kiểu, không giá trị; console hiện "Thiếu trường bắt buộc: service, detail".

## Bổ sung — 2026-10-13: trần số hook thành cài đặt hệ thống

- Bỏ trần cứng 10 hook mỗi app. Trần nay là cài đặt hệ thống `incoming.max_hooks_per_app` (mặc định 20, cho
  phép 1–50, chỉ Super Admin chỉnh) — mỗi công cụ ngoài nên có hook riêng.
- Chốt như cũ: `slot` 1…N + unique `(app_id, slot)`; đếm theo SỐ hook đang có. Không migration.
- Console bỏ dòng "Tối đa 10 webhook mỗi app"; vượt trần -> 422 `INCOMING_HOOK_LIMIT_REACHED` như cũ.
