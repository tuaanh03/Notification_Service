# ADR-0029 — Outgoing webhook: EWS tự báo kết quả gửi thư cho app

**Trạng thái:** chấp nhận — 2026-10-10.

## Bối cảnh

App muốn biết thư đã đi chưa thì phải hỏi `GET /v1/notifications/:id` (hoặc `/v1/publications/:id`,
ADR-0028) nhiều lần. Kết quả gửi đã có sẵn dạng event trong outbox (`NotificationSent` /
`NotificationFailed` / `NotificationNoRecipient`) nhưng chỉ đi `audit.events`.

## Quyết định

1. **Module mới `webhooks`** (module thứ 11). App đăng ký URL trên console; EWS `POST` sang mỗi khi một
   thư có kết quả. Ba sự kiện: `notification.sent`, `notification.failed`, `notification.no_recipient`
   (+ `ping` cho nút "Gửi thử", không đăng ký được). Body: `{ id, type, createdAt, data }`, `data` lấy
   từ query công khai mới `notifications/GetNotificationOutcome` — có `externalId`, `topic`, `status`,
   `publicationId`, `exclusionReason`, `error`; KHÔNG có địa chỉ email và nội dung thư.
2. **Worker gửi thư không đổi.** Ba event trên thêm một đích trong `EVENT_ROUTES` -> stream
   `webhook.events`.
3. **Hai bước, tách gọi ra ngoài khỏi transaction:**
   - consumer `webhook-dispatcher` (chế độ mặc định của khung — transaction + khử trùng theo outbox id)
     chỉ GHI mỗi URL đăng ký sự kiện một dòng `webhook_deliveries` `pending`, cùng body chốt sẵn;
   - job `deliver-webhooks` (scheduler, 5 giây): tx ngắn nhận tối đa 20 lượt đến hạn (`FOR UPDATE SKIP
     LOCKED`, dời `next_attempt_at` thành hạn giữ việc 2 phút) -> gọi HTTPS NGOÀI transaction, song song
     -> tx ngắn ghi kết quả CÓ ĐIỀU KIỆN `attempts` chưa đổi. Process chết giữa chừng thì hết hạn giữ
     việc lượt đó đến hạn lại.
4. **Gọi ít nhất một lần, không đảm bảo thứ tự.** 2xx trong 10 giây = xong; còn lại (mã khác, quá giờ,
   redirect, không kết nối được) gọi lại sau 1 phút · 5 phút · 30 phút · 2 giờ · 6 giờ — tổng 6 lần rồi
   `failed`. Body và `id` sự kiện giữ nguyên qua mọi lần gọi; app bỏ bản trùng theo `id`.
5. **Chữ ký** `X-EWS-Signature: t=<giây unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` + `X-EWS-Event`,
   `X-EWS-Delivery-Id`. Ký lại mỗi lần gọi (có giờ ký mới), body không đổi.
6. **Secret không lưu** — `whsec_` + HMAC-SHA256(`WEBHOOK_SIGNING_KEY`, `"webhook-secret:<endpointId>:<version>"`).
   Lộ bản sao DB không lộ secret. Đổi secret = `secret_version + 1`, secret mới chỉ nằm trong response.
   Biến mới `WEBHOOK_SIGNING_KEY` (≥ 32 ký tự, tuỳ chọn): trống = webhook tắt — tạo / đổi secret / gửi thử
   trả 503 `WEBHOOK_NOT_CONFIGURED`, job không gọi gì, `GET …/webhooks` trả `configured: false`. Đổi
   khoá chủ = secret của mọi URL đổi theo.
7. **Chặn gọi vào mạng nội bộ** (EWS ở `10.36.x`): URL phải `https://`, không user:pass, không `#`,
   không `localhost` / IP nội bộ viết thẳng (422 `WEBHOOK_URL_INVALID`). Lúc gọi, `lookup` của chính kết
   nối phân giải DNS và từ chối nếu BẤT KỲ địa chỉ nào là IP nội bộ (`isPrivateAddress`: 0/8, 10/8,
   127/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16, ≥ 224, `::`, `::1`, fc00::/7, fe80::/10, ff00::/8,
   IPv4 nhúng) — IP đã kiểm là IP được kết nối. Không đi theo redirect, không đọc body phản hồi.
   Bản đầu chặn HẾT IP nội bộ; app nhận webhook trong mạng nội bộ cần một danh sách cho phép — làm sau.
8. **Tối đa 2 URL mỗi app** bằng cột `slot` (1 | 2) + unique `(app_id, slot)` thay vì khoá dòng `apps`
   (bảng của module khác). Hai lệnh thêm song song: bên thua nhận `WebhookSlotTakenError`, đọc lại và thử
   chỗ còn lại; hết chỗ -> 422 `WEBHOOK_LIMIT_REACHED` (test `race()` 5 lệnh -> đúng 2 URL).
9. **Route** dưới `/admin/apps/:appId/webhooks`: `GET` (danh sách + `configured`, `app.read`), `POST`
   (thêm, trả secret, `app.manage`), `PATCH /:id` (đổi sự kiện, tắt / bật), `POST /:id/rotate-secret`,
   `DELETE /:id` (xoá cả nhật ký), `POST /:id/test` (gọi `ping` NGAY, không gọi lại, vẫn ghi nhật ký),
   `GET /:id/deliveries` (50 lượt gần nhất, `app.read`). Tắt URL -> lượt đang chờ thành `failed` /
   `endpoint_disabled` (bật lại không dồn gọi sự kiện cũ). URL của app khác -> 404.
10. Audit: `WebhookEndpointCreated` / `Updated` / `SecretRotated` / `Deleted`. Từng lượt gọi không audit —
    nhật ký là `webhook_deliveries`.

## Không làm

- Sự kiện "lần phát đã xong" (`publication.completed`): phải khoá dòng lần phát mỗi khi một thư con
  xong, tức là sửa worker gửi thư. App đếm theo `publicationId` hoặc gọi `GET /v1/publications/:id`.
- Danh sách IP nội bộ được phép, dọn nhật ký cũ, tự tắt URL lỗi lâu ngày.
- Màn Webhooks trên console (giai đoạn 2), incoming webhook (sau đó).

## Hệ quả

- Migration `0011_webhooks`: `webhook_endpoints`, `webhook_deliveries`.
- Stream mới `webhook.events`; consumer group mới `webhook-dispatcher`; job mới `deliver-webhooks`.
- Biến môi trường mới `WEBHOOK_SIGNING_KEY` — thêm vào `.env.example`, `docker-compose.yml` (repo và
  deploy). Production: tự sinh `openssl rand -base64 32`, thêm vào `.env`, khởi động lại api / worker /
  scheduler.
- Tài liệu cho đội app: `huong-dan-tich-hop-cho-doi-app.md` mục 5 (nhận webhook, kiểm chữ ký, xử lý trùng).
- Test: `test/unit/webhooks.test.ts`, `test/integration/webhooks-api.test.ts`.

## Bổ sung — 2026-10-13: trần số URL thành cài đặt hệ thống

- Bỏ trần cứng 2 URL (§8). Trần nay là cài đặt hệ thống `webhooks.max_endpoints_per_app` (mặc định 10, cho
  phép 1–50, chỉ Super Admin chỉnh). Một app thường cần gửi về nhiều nơi (prod, staging, hệ thống log); vẫn
  giữ trần vì mỗi URL là thêm một lần gọi cho mỗi thư.
- Cách chốt không đổi: mỗi URL giữ một chỗ `slot`, nay là 1…N; unique `(app_id, slot)` quyết khi chạy song
  song. Đếm theo SỐ URL đang có — trần vừa bị hạ thì URL cũ giữ nguyên, chỉ không cho thêm. Không migration.
- Console bỏ dòng đếm "x/2 URL"; vượt trần -> 422 `WEBHOOK_LIMIT_REACHED` như cũ.
