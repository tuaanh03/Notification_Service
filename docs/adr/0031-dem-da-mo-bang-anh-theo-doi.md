# ADR-0031 — Đếm "đã mở" bằng ảnh theo dõi trong thư

**Trạng thái:** chấp nhận — 2026-10-16. Backend (mặc định tắt) · console (công tắc, dấu "đã mở", tỉ lệ mở trên Tổng quan) · webhook `notification.opened`.

## Bối cảnh

Đội app muốn biết người nhận đã mở thông báo hay chưa. Hiện trạng thái cuối của thư là `sent` = Graph
đã NHẬN thư (`sendMail` trả 202, không kèm id thư) — EWS không biết thư đã vào hộp hay đã được đọc.

Người nhận là nhân viên trong cùng tenant M365, nên đã cân nhắc đọc cờ `isRead` thẳng trong hộp thư
người nhận. **Bỏ**, vì quyền nhỏ nhất làm được việc đó là application `Mail.ReadBasic.All`: đọc tiêu đề,
người gửi / nhận, thời gian của MỌI thư trong MỌI hộp thư của công ty (không có quyền "chỉ trạng thái
đọc của thư mình gửi"; RBAC for Applications của Exchange chỉ thu hẹp được hộp thư nào, không thu hẹp
được trường nào). Lộ credentials là lộ ai liên lạc với ai về chuyện gì trong cả công ty — quá đắt so
với một con số "đã mở". Ngày 2026-10-16 đã kiểm trên prod: app gửi thư KHÔNG có quyền này, và giữ nguyên.

Read receipt (xác nhận đã đọc) cũng bỏ: người nhận bấm từ chối được, và EWS phải đọc hộp noreply.

## Quyết định

1. **Ảnh 1×1 trong thư.** Worker `email-sender` chèn `<img>` ngay trước `</body>` cuối cùng (không có
   `</body>` thì nối cuối) — hàm thuần `withOpenPixel`. Chỉ phần HTML; text thuần giữ nguyên. Ảnh chèn
   lúc GỬI, không lúc nhận request: nội dung lưu trong `notifications` vẫn là bản app gửi lên.
2. **Bật theo app, mặc định tắt** — cột `apps.track_opens`. `PUT /admin/apps/:appId/open-tracking`
   `{ enabled }` (`app.manage`, cùng quyền cấp khoá API), audit `AppOpenTrackingChanged` (before / after);
   đặt lại giá trị đang có thì không ghi, không audit. `AppDto.trackOpens`. Chỉ áp cho thư gửi SAU lúc đổi.
3. **Chèn ảnh khi đủ ba điều kiện**: app bật · Super Admin đã khai `api.public_base_url` (cài đặt hệ
   thống có sẵn — ADR-0030) · server có `WEBHOOK_SIGNING_KEY`. Thiếu một thứ thì gửi HTML gốc, không lỗi.
   Tra cờ TRƯỚC khi nhận việc (tx1): lỗi ở đó thì notification vẫn `queued`, không thành `outcome_unknown`.
   Log `email delivery finished` có thêm `open_tracking`.
4. **URL:** `<public_base_url>/t/o/<notificationId>/<chữ ký>.gif`. Chữ ký = HMAC-SHA256(`WEBHOOK_SIGNING_KEY`,
   `"email-open:<notificationId>"`) base64url — không lưu, tính lại được; chuỗi đầu vào khác token
   incoming / secret outgoing nên không trùng dù chung khoá. Chặn người ngoài tự ghép URL để đếm khống.
   Đổi khoá chủ = ảnh trong thư cũ thôi được đếm (chấp nhận).
5. **`GET /t/o/:notificationId/:file`** trên bề mặt public: chữ ký đúng + thư đã `sent` -> trong một
   transaction, `UPDATE … SET first_opened_at = now, open_count + 1 WHERE first_opened_at IS NULL`; không
   khớp thì `UPDATE … open_count + 1`. Không đọc trước: hai lượt cùng lúc không mất lượt, và đúng MỘT lượt
   là "lần đầu". Lần đầu phát `NotificationOpened` (-> audit + webhook `notification.opened`, xem bổ sung
   ADR-0029); mở lại không phát gì. Sai gì cũng trả CÙNG ảnh GIF 42 byte, 200 — không dò được URL nào là
   thật. `Cache-Control: no-store`.
6. **Đọc cho console:** `GET /admin/apps/:appId/open-tracking` (`app.read`, module notifications) trả
   `{ enabled, ready }` — `ready` = khoá ký + domain công khai, cùng điều kiện worker dùng. Lịch sử gửi
   (`GET /admin/apps/:appId/notifications`) có thêm `recipient.firstOpenedAt` / `openCount`; `/v1` KHÔNG có
   (ngoài hợp đồng với đội app). Console: trang Cài đặt App › Theo dõi mở thư, dấu "đã mở" (chỉ biểu tượng)
   trong ô Kết cục.
   **Tỉ lệ mở** (Tổng quan, `opens: { tracked, opened }` trong 24 giờ): mẫu số là thư `sent` CÓ chèn ảnh —
   cột `notification_recipients.open_tracked`, worker chốt lúc nhận việc. Không có cột này thì thư gửi trước
   lúc bật / của app tắt đếm kéo tỉ lệ xuống sai. `tracked = 0` -> console hiện "—".
7. **Con số là ƯỚC LƯỢNG** — ghi ở tài liệu (ADR này, hướng dẫn tích hợp); màn hình không đặt ghi chú dài:
   - Outlook bản cài máy thường chặn ảnh -> đã mở mà không đếm;
   - Apple Mail Privacy Protection, bộ quét bảo mật tải sẵn ảnh -> chưa mở mà đã đếm;
   - proxy ảnh của nhà mail có thể cache -> lượt mở sau không tới;
   - thư chuyển tiếp: người khác mở vẫn tính cho người nhận gốc.

## Đo thật trên prod — 2026-10-16

3 người nhận nội bộ, 2 thư mỗi người: mở bằng Outlook bản cài máy -> đếm được; Outlook web + app điện
thoại -> đếm được (2 lượt); chưa mở -> không đếm. Outlook máy tính KHÔNG chặn ảnh với thư từ trong tenant,
nên chưa cần đếm bấm link.

## Không làm (bước sau, khi cần)

- Đếm bấm link (đổi link qua EWS rồi chuyển tiếp, lọc lượt bấm của bộ quét bảo mật), `notification.clicked`.
- Trường "đã mở" trong `GET /v1/notifications/:id` — app dùng webhook `notification.opened`.
- Giới hạn tốc độ riêng cho `/t/o/*` (chữ ký sai không chạm DB; chữ ký đúng chỉ một UPDATE theo PK).
