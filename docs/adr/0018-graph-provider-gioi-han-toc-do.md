# ADR-0018 — Provider Microsoft Graph và giới hạn tốc độ gửi

**Trạng thái:** chấp nhận — 2026-09-19. Bổ sung cho ADR-0016 (GĐ 4 của `implementation_plan.md`).

## Bối cảnh
GĐ 3 gửi end-to-end bằng `MockEmailProvider`. GĐ 4 thay bằng Microsoft Graph `sendMail` thật, và
Exchange Online giới hạn tốc độ gửi **theo mailbox người gửi** — vượt thì bị 429 hàng loạt, nặng hơn
là mailbox bị khoá gửi. Nhiều bản worker chạy song song nên giới hạn phải đếm chung.

## Quyết định

**D1 — `GraphEmailProvider`** (`delivery/infrastructure/adapters/`), gọi bằng `fetch` có sẵn, không
thêm SDK:
- Client credentials (`/oauth2/v2.0/token`, scope `https://graph.microsoft.com/.default`, quyền
  application `Mail.Send`). Không có người dùng đăng nhập -> **không cần redirect URI**
  (`MICROSOFT_REDIRECT_URI` trong `.env` không được đọc).
- Token cache trong process, làm mới trước hết hạn 5 phút; nhiều lần gửi cùng lúc chỉ tạo MỘT request token.
- `POST /v1.0/users/{EMAIL_SENDER_ADDRESS}/sendMail`, `saveToSentItems: false`, header
  `X-EWS-Notification-Id` (qua `internetMessageHeaders`) và `client-request-id = notificationId` để truy vết.
- Mọi request có `AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS)`.

**D2 — Phân loại kết quả** theo câu hỏi "Microsoft đã nhận thư chưa?" (ADR-0016 D3):

| Graph trả | Kết quả | Lý do |
| --- | --- | --- |
| 202 | `accepted` (`providerMessageId` = header `request-id`) | |
| 429, 503 | `retryable`, chờ theo `Retry-After` (giây) nếu có | bị chặn trước khi xử lý |
| 401 | `retryable` ngay, bỏ token cache | token hết hạn / bị thu hồi |
| 4xx khác | `rejected` | vĩnh viễn: địa chỉ sai, mailbox không có quyền... |
| 500 / 502 / 504 | `unknown` | có thể đã nhận rồi mới lỗi — **không gửi lại** |
| ECONNREFUSED, ENOTFOUND, EAI_AGAIN, ENETUNREACH, EHOSTUNREACH | `retryable` | request chưa từng đi |
| timeout, ECONNRESET, lỗi mạng khác | `unknown` | không biết |
| token bị Entra ID từ chối (400/401) | `rejected` | cấu hình sai, thử lại không khỏi |
| token endpoint lỗi khác | `retryable` | chưa có token = thư chắc chắn chưa đi |

Số lần thử và tổng thời gian chờ vẫn do `SendEmail` giữ (3 lần, ≤ 2 phút).

**D3 — Giới hạn tốc độ `EMAIL_MAX_PER_MINUTE`** (mặc định 30):
- `FixedWindowRateLimiter` ở `src/shared/rate-limit/` — cửa sổ cố định 1 phút trên Redis
  (`MULTI INCR + PEXPIRE`, một round-trip), bucket theo mailbox gửi, dùng chung mọi worker. Chọn cửa sổ
  cố định thay vì token bucket trơn: đơn giản, không cần Lua, đủ để không vượt trần mỗi phút. Đầu phút có
  thể dồn cục — chấp nhận ở MVP. Tái dùng được cho quota theo app ở API (sau MVP).
- Port `SendRateLimiter` (`delivery/application/ports/`) + adapter `RedisSendRateLimiter`. Port
  `EmailSender` của `notifications` thêm `awaitCapacity()`.
- **Chờ lượt SAU gate, TRƯỚC tx1 "nhận việc".** Thư bị gate chặn không tốn lượt; trong lúc chờ,
  notification vẫn `queued` — worker chết lúc này thì message được giao lại và gửi bình thường, không
  thành `outcome_unknown` oan. Chờ lâu hơn `claimIdleMs` khiến message bị worker khác nhận lại: vô hại,
  conditional update ở tx1 vẫn chỉ cho một bên gửi (chỉ tốn thêm một lượt đếm).
- `shared/rate-limit` chạm Redis nên chỉ `infrastructure` của module được import (luật kiến trúc).

**D4 — Cấu hình.** `loadEnv` fail-fast: `EMAIL_PROVIDER=graph` thiếu một trong `EMAIL_SENDER_ADDRESS`,
`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` thì process không khởi động và nêu đủ biến
thiếu. Compose truyền các biến này qua `${VAR:-}` (không dùng `env_file`); giá trị thật chỉ nằm trong
`.env` (git bỏ qua). `npm run email:test -- <địa chỉ>` gửi một thư thử qua đúng `SendEmail` mà worker dùng.

## Hệ quả
- Chỉ gửi HTML: body JSON của `sendMail` mang một nội dung; `text` để dành khi chuyển sang gửi MIME.
- Bounce (NDR) vẫn về hộp thư người gửi, chưa xử lý (sau MVP).
- Quyền `Mail.Send` application mặc định gửi được thay MỌI mailbox trong tenant — nên giới hạn App
  Registration vào đúng mailbox gửi bằng Application Access Policy / RBAC for Applications của Exchange.
- Token cache theo process: mỗi worker lấy token riêng — không đáng kể (một request mỗi giờ mỗi worker).
