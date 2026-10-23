# ADR-0041 — Cửa nhận khi nhiều app: giới hạn gọi, làn ưu tiên, trần ngày hộp gửi, trần hàng chờ

**Trạng thái:** chấp nhận — 2026-10-23. Bổ sung ADR-0013 / 0016 / 0018 / 0032.

## Bối cảnh

Sắp có nhiều app tích hợp. Câu hỏi: có nên đặt thêm một hàng đợi ở cửa vào (nhận request thô rồi mới kiểm)? **Không.**
EWS đã nhận theo kiểu hàng đợi từ đầu: `api` kiểm input, ghi DB + outbox rồi trả `202` (ADR-0013 / 0014); thư nằm
trong MySQL trước khi app nhận `202`. Đặt hàng đợi phía trước làm mất lỗi `422` tức thì (sai topic, thiếu biến…) mà
không gửi được nhanh hơn — cửa ra là MỘT hộp thư noreply (~30 thư/phút, ~10 000 người nhận / 24 giờ của Microsoft).

Bốn chỗ hở thật khi nhiều app dùng chung cửa ra:
1. `apps.rate_limit_per_minute` (mặc định 60) có từ UC-001 nhưng KHÔNG được áp ở `/v1`.
2. Một hàng `notif.queued` FIFO chung: app A xếp 3 000 thư thì tin bắt buộc của app B đợi sau.
3. Không có trần ngày cho hộp gửi; vượt mức của Microsoft là hộp bị khoá gửi, mọi app cùng dừng.
4. Không thấy app nào đang chiếm hàng chờ; app gửi dồn được nhận hết rồi để thư đi sau nhiều giờ.

## Quyết định

1. **Số lần gọi API gửi mỗi phút.** `POST /v1/notifications` và `POST /v1/publications` đếm theo app (`WindowQuota`
   khung 1 phút, `quota:call:<app>:<phút>`); vượt `rate_limit_per_minute` -> 429 `APP_RATE_LIMITED`, `Retry-After` tới đầu
   phút sau. Đếm ngay sau khi kiểm dạng nội dung, TRƯỚC khi tra trùng `idempotencyKey` (gọi lại cũng là một lần gọi). Không áp cho đường gửi từ console và incoming
   webhook (đã có giới hạn riêng — ADR-0030). Super Admin chỉnh: `PUT /admin/apps/:appId/api-rate-limit { perMinute }`
   (1–10 000, `API_RATE_LIMIT_INVALID`, `platform.manage`, audit `AppApiRateLimitChanged`). Dữ liệu cũ không đổi:
   app đang có giữ con số đã lưu (mặc định 60) — **kiểm lưu lượng thật của từng app trước khi deploy**.
2. **Trần mỗi giờ mặc định cho app MỚI.** Cài đặt `apps.default_max_send_per_hour` (600, 0–100 000; 0 = không trần) gắn
   vào `max_send_per_hour` lúc `CreateApp`. App đã có không bị đổi.
3. **Làn ưu tiên cho tin bắt buộc.** `NotificationQueued` của topic bắt buộc mang `priority: true`; `routeEvent` đưa
   sang stream `notif.queued.priority` (thay cho `notif.queued`), consumer group `email-sender-priority` chạy cùng use
   case `DeliverEmailNotification`. Gắn cờ ở cả ba chỗ phát event: nhận thư, phát vào topic, `promote-scheduled` (tra
   `mandatory` của topic, mỗi topic một lần mỗi lượt). Ở worker, hai làn cùng đếm MỘT bucket theo phút của hộp gửi: làn
   thường dừng ở `EMAIL_MAX_PER_MINUTE - EMAIL_PRIORITY_RESERVE_PER_MINUTE` (mặc định 30 - 5), làn ưu tiên đi tới trần.
   `FixedWindowRateLimiter` vì thế HOÀN lượt bị từ chối (script Lua) — nếu không, làn thường bị từ chối liên tục sẽ đẩy
   bộ đếm vượt luôn phần giữ. Phần giữ là biến môi trường (đi cùng `EMAIL_MAX_PER_MINUTE`), không phải cài đặt console.
4. **Trần ngày của hộp gửi chung.** Cài đặt `delivery.mailbox_daily_cap` (9 000, 100–10 000). Giữ lượt LÚC NHẬN như dàn
   đều (ADR-0032 GĐ 2), trong `planSendTimes`, sau khung giờ + dàn đều: `DaySlotAllocator` (Lua, `mailbox:day:<đầu ngày
   VN>`) — ngày đủ trần thì lượt rơi sang ngày sau; thư thường bị dời thành `scheduled` lúc khung giờ của app mở trong ngày
   đó (không có khung: 0 giờ), lý do audit `daily_cap`. Tin bắt buộc vẫn ĐẾM nhưng không bao giờ bị dời. Đếm lúc nhận nên
   thư sau đó bị chặn ở worker (consent, giới hạn mỗi người) vẫn tính — sai về phía an toàn.
5. **Trần hàng chờ mỗi app.** Cài đặt `apps.max_pending_per_app` (5 000, 100–100 000). Thư chưa xong (`scheduled` +
   `queued` + `sending`) cộng số thư sắp nhận vượt trần -> 429 `APP_QUEUE_FULL`, `Retry-After: 60`, không nhận thư nào.
   Kiểm ĐẦU TIÊN trong `planSendTimes` (trước khi giữ bất kỳ lượt Redis nào). Áp cả tin bắt buộc: một app lỗi vòng lặp
   gửi tin bắt buộc cũng phải bị chặn.
6. **Màn Hàng chờ gửi** — `GET /admin/delivery-queue` (`platform.manage`): lượt đã giữ hôm nay / trần ngày, tốc độ mỗi
   phút + phần giữ, tổng thư đang chờ, thời gian chờ ước tính của thư thường (`queued + sending` mọi app chia lượt mỗi
   phút của làn thường), từng app có thư chưa xong (`scheduled` / `queued` / `sending`, thư chờ cũ nhất).

Thứ tự ở cửa nhận: số lần gọi -> (trùng idempotency) -> kiểm input -> hàng chờ đầy -> trần mỗi giờ -> khung giờ -> dàn
đều -> trần ngày.

## Hệ quả

- Mọi lần nhận thư giờ chạm Redis (trước đây app không đặt giới hạn thì không). Redis đã là hạ tầng bắt buộc
  (`/health/ready` ping Redis).
- `WORKER_GROUPS` khai danh sách cụ thể thì phải thêm `email-sender-priority`, nếu không tin bắt buộc nằm im trong stream
  (khởi động không báo lỗi vì group không thiếu — chỉ không được chọn). Mặc định `all` chạy cả hai.
- Message cũ đã nằm trong `notif.queued` lúc deploy vẫn đi bình thường qua `email-sender`.
- Tài liệu cho đội app: `huong-dan-tich-hop-cho-doi-app.md` mục 4 (thư `scheduled` vì trần ngày), mục 6 (giới hạn gọi),
  mục 8 (mã 429 mới).
- Test: `test/integration/ingress-limits-api.test.ts`, `rate-limit.test.ts` (hai làn, `DaySlotAllocator`),
  `test/unit/send-pacing.test.ts`, `test/unit/stream-routing.test.ts`.

## Không làm

- Hàng đợi ở cửa vào (lý do ở Bối cảnh).
- Thêm hộp gửi / xoay vòng nhiều hộp: cần admin tenant tạo mailbox có license. Bàn khi lưu lượng thật tới gần trần ngày.
- Tách số tin bắt buộc đang chờ trên màn Hàng chờ (cần đọc topic của module khác cho từng thư).
