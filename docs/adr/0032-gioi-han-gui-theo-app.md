# ADR-0032 — Giới hạn gửi theo app: khung giờ, dàn đều, giới hạn mỗi người

**Trạng thái:** chấp nhận — 2026-10-17. GĐ 1 (khung giờ gửi + ngoại lệ tin bắt buộc) xong · GĐ 2 (dàn đều) ·
GĐ 3 (giới hạn mỗi người / trần mỗi app) chưa làm.

## Bối cảnh

Mọi app gửi qua CHUNG một hộp noreply. Microsoft giới hạn hộp đó (~30 thư/phút, ~10.000 người nhận/ngày);
EWS hiện chỉ có `EMAIL_MAX_PER_MINUTE` chung cho mọi app (ADR-0018). Đội app cần thêm: không gửi tin
thường ban đêm / cuối tuần, không dồn một lúc, không để một người nhận quá nhiều thư.

## Quyết định — hai tầng

- **Super Admin giữ trần chung** (bảo vệ hộp noreply, chia công bằng giữa các app): trần thư mỗi app /
  giờ, tốc độ tối đa mỗi app, cho phép tin bắt buộc vượt trần (theo app). Admin App không tự nới được —
  nếu được, app chỉ cần đánh dấu mọi chủ đề là bắt buộc để né.
- **Admin App chỉnh trong trần** (việc nghiệp vụ của app): khung giờ gửi, dàn đều, giới hạn mỗi người /
  ngày, và các ngoại lệ cho tin bắt buộc.

Ngoại lệ cho tin bắt buộc là CÔNG TẮC theo app, mặc định bật (cảnh báo lúc 2 giờ sáng vẫn đi ngay).

## GĐ 1 — khung giờ gửi

1. **Cấu hình trên app**: `apps.send_window` (JSON `{ days, start, end }`, NULL = gửi mọi lúc) +
   `apps.mandatory_bypass_window` (mặc định true). `PUT /admin/apps/:appId/send-window`
   `{ window: {…} | null, mandatoryBypass }` — `app.manage`, audit `AppSendWindowChanged` (before / after),
   không đổi thì không ghi. `AppDto.sendWindow` / `mandatoryBypassWindow`.
2. **Giờ Việt Nam cố định UTC+7** (không có giờ mùa hè) — không lưu múi giờ. `days` 1 = thứ Hai … 7 = Chủ
   nhật; `start` < `end`, `end` có thể là `24:00`. Khung qua nửa đêm chưa hỗ trợ (tin cần gửi đêm là tin
   bắt buộc). Luật thuần ở `shared/kernel/send-window.ts` (`parseSendWindow`, `nextSendOpening`) vì hai
   module cùng dùng; mã lỗi `SEND_WINDOW_DAYS_REQUIRED` · `_DAY_INVALID` · `_TIME_INVALID` · `_EMPTY`.
3. **Giữ lúc NHẬN, không lúc gửi.** `AcceptEmailNotification` / `PublishToTopic` gọi `sendHoldUntil`: ngoài
   khung -> notification tạo thẳng ở `scheduled`, `scheduled_at` = lúc khung mở, phát `NotificationScheduled`
   (chỉ audit). Dùng lại trạng thái `scheduled` và luồng `scheduled -> queued` (`due`) đã có trong bảng
   chuyển trạng thái — không thêm trạng thái, không sửa worker.
4. **Job `promote-scheduled`** (scheduler, 15 giây): `scheduled` có `scheduled_at <= now` -> `due` ->
   `queued` + `NotificationQueued`, lô 500, ghi có điều kiện (nhiều bản chạy song song an toàn). Worker
   kiểm consent lại lúc gửi như thường.
5. **Đổi khung không dời thư đang chờ**: giờ hẹn chốt lúc nhận. Thư đã nhận ngoài khung cũ vẫn đi đúng
   giờ đã hẹn.
6. `/v1`: `status` có thể là `scheduled`, DTO thêm `scheduledAt` (hai tài liệu tích hợp đã ghi). Lần phát
   vào topic: thư con `scheduled` tính vào `pending`. Tổng quan: `scheduled` vào cột "đang chờ" của biểu đồ;
   `queue.waiting` vẫn chỉ `queued` + `sending` (thư chờ khung giờ không phải hàng chờ bị kẹt).

Lúc khung mở, mọi thư chờ được thả cùng lúc; giới hạn chung `EMAIL_MAX_PER_MINUTE` vẫn chặn tốc độ. Dàn
đều theo app là GĐ 2.

## Chưa làm (GĐ sau)

- GĐ 2 — dàn đều theo app (thư/phút ≤ mức Super Admin cho); app hết lượt thì thư dời sang phút sau thay vì
  worker đứng chờ (không để một app chặn app khác). Ngoại lệ "tin bắt buộc gửi trước".
- GĐ 3 — giới hạn mỗi người / ngày (thư vượt -> bỏ qua có lý do), trần thư mỗi app / giờ (vượt -> 429),
  ngoại lệ "tin bắt buộc vượt trần" do Super Admin bật.
- Huỷ thư đang chờ khung giờ.
