# ADR-0028 — Phát tin vào topic: một lời gọi gửi cho mọi người đang theo dõi topic

**Trạng thái:** chấp nhận — 2026-10-09.

## Bối cảnh

App chỉ gửi được cho MỘT người mỗi lời gọi (`POST /v1/notifications`, ADR-0016). Muốn báo cả nhóm
(bảo trì, sự cố) thì app phải tự giữ danh sách và lặp — trong khi EWS đã biết ai theo dõi topic nào
(`effectiveOptIn`, ADR-0010). Người dùng chốt: "sub" chỉ là người dùng nhận email (không có hệ thống
khác đăng ký topic qua webhook); mỗi topic ≤ 50 người.

## Quyết định

1. **Route mới** `POST /v1/publications` + `GET /v1/publications/:id`, xác thực bằng API key như mọi
   `/v1`. Body như gửi lẻ nhưng không có `to`: `topic` + (`subject` / `html` / `text` HOẶC `templateId`
   + `payload`) + `idempotencyKey`. Kiểm nội dung / topic / template bằng CÙNG hàm với gửi lẻ
   (`commands/send-input.ts`).
2. **Một lần phát = một dòng `publications` + N notification con** (`notifications.publication_id`).
   Mỗi con là một thư gửi lẻ bình thường (`queued`, `target_user_id`, nội dung đã đổ biến) và đi đúng
   đường cũ: outbox `NotificationQueued` -> `notif.queued` -> worker `email-sender` **không sửa**.
   At-most-once, giới hạn tốc độ, `fail-stuck-sending`, `GET /v1/notifications/:id` dùng lại nguyên.
   Lần phát không có trạng thái riêng — tiến độ tính từ các con lúc đọc (`in_progress` / `completed`,
   `counts`).
3. **Người nhận chốt lúc phát** bằng `selectTopicAudience` = `emailGate` cho từng user có email trong
   app — đúng cổng worker chạy lại trước khi gửi từng thư. Người đổi ý ở giữa thì worker chặn
   (`no_recipient`, đếm `skipped`). Không dùng `resolveRecipients` của `segments`: trong một app,
   không segment, gộp theo user thì pipeline trùng đúng `emailGate` từng người; kéo `segments` vào
   `notifications` là thêm một ngoại lệ phụ thuộc mà không thêm luật nào.
4. **Trần 100 người** (`MAX_PUBLICATION_RECIPIENTS`, cố định trong code — gấp đôi quy mô dự kiến).
   Vượt -> 422 `PUBLICATION_TOO_LARGE`, không ghi gì. Nhờ trần này, lần phát + mọi con + mọi event
   ghi trong MỘT transaction: đủ cả hoặc không có gì. Topic không ai theo dõi không phải lỗi
   (`recipientCount: 0`).
5. **`idempotencyKey` bắt buộc** (thiếu -> 422 `IDEMPOTENCY_KEY_REQUIRED`): phát trùng là cả nhóm nhận
   thư trùng. Unique `(app_id, idempotency_key)` trên `publications` — tập khoá riêng với gửi lẻ. Hai
   request đua nhau: bên thua chờ unique index, rồi đọc lại lần phát của bên thắng (test `race()`).
6. **Topic bắt buộc phát được.** App đã gửi lẻ tin bắt buộc được; cấm ở đây chỉ bắt app lặp. Chỉ admin
   đặt được cờ bắt buộc. Email đã ngắt / hỏng vẫn chặn cả tin bắt buộc (L0).
7. **Template đổ biến từng người** — `{{ user.external_id }}` khác nhau giữa người nhận. Đổ hết trước
   transaction (lỗi template là 422 trước khi ghi). Không ai nhận vẫn đổ một lần để template sai không
   lọt qua im lặng.
8. **Không stream riêng.** Thư con xếp chung `notif.queued` với thư lẻ: 50 thư ở 30 thư/phút làm thư lẻ
   chờ thêm khoảng 2 phút — chấp nhận ở quy mô này.
9. Audit: một dòng `TopicPublished` (aggregate `Publication`; `after`: topic, cờ bắt buộc, số người
   nhận, khoá) + `NotificationQueued` của từng con (`after.publicationId`).
10. `NotificationDto` (v1 và lịch sử admin) có thêm `publicationId`. `PublicationDto` không có nội dung
    thư và địa chỉ email — chỉ `externalId` + `notificationId` + trạng thái từng con.

## Không làm

- Hệ thống khác đăng ký topic bằng URL (pub/sub giữa hệ thống).
- Phát quá 100 người (cần chia lô + chạy nền), phát theo segment, hẹn giờ / huỷ lần phát.
- Màn "Lần phát" trên console, outgoing webhook báo kết quả, incoming webhook gắn topic — các giai
  đoạn sau, duyệt riêng.

## Hệ quả

- Migration `0010_publications`: bảng `publications`, cột + FK + index `notifications.publication_id`.
- Port mới / mở rộng (đều theo lô, một truy vấn): `EmailLookup.listByApp` (-> `FindUserEmail.listOf`),
  `TopicConsentLookup.preferences` (-> `ConsentQueries.preferencesOf`), `NotificationRepository.listByPublication`,
  `PublicationRepository`.
- Đổi hợp đồng `/v1`: sửa `docs/huong-dan-tich-hop-cho-doi-app.md` (mục 5, 6, 8, 9),
  `docs/tich-hop-app-chi-tin-bat-buoc.md` và `lib/api/v1-errors.ts` của console.
- Test: `test/unit/topic-audience.test.ts`, `test/integration/publications-api.test.ts`.
