# ADR-0042 — Quản trị hàng đợi trên console: xem stream, xử lý message lỗi, tạm dừng nhóm xử lý

**Trạng thái:** chấp nhận — 2026-10-23. Giai đoạn 1 của đề xuất "admin console quản lý queue". Bổ sung ADR-0013 / 0041.

## Bối cảnh

Người dùng muốn console quản lý mọi queue: bao nhiêu queue, thông số, và quyền tạo stream mới. Hiện trạng: 4 stream có
consumer (`notif.queued`, `notif.queued.priority`, `webhook.events`, `audit.events`) + DLQ `<stream>.dlq`; thông số consumer
cố định trong code; message vào DLQ nằm im, chỉ xem được bằng `redis-cli`; khi dịch vụ ngoài hỏng không có cách dừng gửi.

**Không làm nút "tạo stream".** Stream chỉ có nghĩa khi có code xử lý message của nó — stream tạo từ console không ai đọc
là hàng chờ chết. Thay bằng "làn gửi" (giai đoạn 3, chưa làm). Giai đoạn 2 (chỉnh thông số không cần khởi động lại) chưa làm.

## Quyết định

1. **Module `queues`** (chỉ có application + interface — không có bảng riêng). Đọc / thao tác Redis qua port `QueueAdmin`;
   hiện thực `StreamAdmin` nằm ở `shared/streams` (module không chạm client Redis — luật kiến trúc), composition truyền vào.
   Danh sách group lấy từ registry consumer của MỌI module (`queuesModule` dựng cuối trong `buildApplication`), thông số gộp
   mặc định `CONSUMER_DEFAULTS` của khung consumer — màn hiện đúng con số đang áp. Stream khai tên mà chưa có consumer không hiện.
2. **`GET /admin/queues`** — mỗi group: `length` (XLEN — stream bị cắt theo MAXLEN nên đây không phải hàng chờ thuần),
   `lag` (chưa giao — chính là hàng chờ), `pending` (đã giao chưa ACK), message treo lâu nhất, số message DLQ, consumer (bản
   worker) còn sống + `idle`, `paused`, `pausable`, thông số; kèm bộ nhớ Redis. **`GET /admin/queues/dead-letters`**
   `?stream=&limit=` (≤ 200, mới nhất trước) — loại event, id đối tượng, lý do (`permanent_error` / `max_deliveries`), lỗi,
   số lần giao. KHÔNG trả payload (có thể có dữ liệu cá nhân).
3. **Đẩy lại** `POST …/dead-letters/:stream/:id/requeue`: field gốc (bỏ `dlq_*`) XADD về stream gốc + XDEL khỏi DLQ trong
   MỘT MULTI. An toàn vì khử trùng theo `outbox_id` (framework) / trạng thái DB (gửi email) — message đã xong không chạy hai
   lần. **Bỏ** `POST …/discard { reason }`: XDEL, lý do bắt buộc (`DISCARD_REASON_REQUIRED`, ≤ 500).
4. **Tạm dừng / chạy lại** `PUT /admin/queues/groups/:group/pause { paused }`: key Redis `consumer:paused:<group>`; vòng lặp
   `StreamConsumer.run` hỏi cờ mỗi lượt (`StreamClient.isPaused`), đang dừng thì ngủ 2 giây — không lấy message mới, không
   nhận lại message treo; message nằm yên trong stream. Có hiệu lực sau tối đa `blockMs` (5 giây), cho mọi bản worker.
   `pollOnce` (test, tác vụ tay) không xét cờ. Group khai `pausable: false` (hiện chỉ `audit-writer` — dừng ghi nhật ký là
   mất dấu vết của chính thao tác dừng) -> 422 `CONSUMER_NOT_PAUSABLE`.
5. **Quyền + audit.** Mọi route `platform.manage` (chỉ Super Admin). Lệnh ghi phát `DeadLetterRequeued` /
   `DeadLetterDiscarded` / `ConsumerGroupPaused` / `ConsumerGroupResumed` (aggregate `DeliveryQueue`, id cố định); lệnh Redis
   chạy TRONG transaction ghi audit — Redis lỗi thì không có dòng audit. Tham số đường dẫn kiểm khuôn (`[a-z0-9._-]`, id
   `<ms>-<seq>`) trước khi vào lệnh Redis.

## Không làm

Tạo / xoá stream, xoá group, sửa nội dung message, cắt stream bằng tay, xem payload trong DLQ.

## Hệ quả

- Mỗi vòng lặp consumer thêm một lệnh `EXISTS` (mỗi ≤ 5 giây mỗi group) — không đáng kể.
- Test: `test/integration/queues-api.test.ts`.
