# ADR-0013 — Redis Streams: outbox relay, khung consumer, idempotency theo outbox id

**Trạng thái:** chấp nhận — 2026-09-18. Hiện thực tài liệu kiến trúc §8 (ADR-0003/0004 gốc) trên MySQL.

## Quyết định

### 1. Mọi event đi qua outbox — không XADD thẳng từ command
Command ghi `EventOutbox.append` trong cùng `uow.run` với thay đổi nghiệp vụ. `OutboxRelay.relayOnce`
(scheduler gọi theo nhịp — lượt 3) làm, trong MỘT transaction:
`SELECT … WHERE published_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED` → XADD cả lô
(pipeline, giữ thứ tự) → `UPDATE published_at`.

### 2. Một event → một dòng outbox cho MỖI stream đích
`routeEvent` (`shared/streams/names.ts`): mọi event vào `audit.events`, cộng stream công việc khai
trong `EVENT_ROUTES` (hiện: `NotificationQueued → notif.queued`). Relay nhờ vậy chỉ XADD từng dòng,
và mỗi stream có trạng thái published riêng.

### 3. At-least-once; khử trùng bằng `dedupKey = outbox:<id>`, KHÔNG bằng message id của Redis
XADD xong mà commit `published_at` hỏng → lượt sau XADD lại với message id MỚI. Nếu consumer khử
trùng theo message id thì event bị xử lý hai lần. `processed_messages` vì thế lưu
`(consumer_group, dedupKey)`.

### 4. Khung consumer (`StreamConsumer`)
Mỗi message: `uow.run { markProcessed(group, dedupKey) → handler(message) }` → COMMIT → XACK.
Handler gọi command thì `uow.run` lồng nhau nhập vào cùng transaction. Phân loại lỗi:

| Lỗi | Xử lý |
| --- | --- |
| `PermanentMessageError`, `DomainError`, message sai định dạng | DLQ ngay (`<stream>.dlq`), ACK bản gốc |
| Lỗi khác (DB/Redis chập chờn) | Không ACK; `reclaimOnce` (XPENDING IDLE + XCLAIM) giao lại sau `claimIdleMs` |
| Giao ≥ `maxDeliveries` (5) lần vẫn lỗi | DLQ với `dlq_reason = max_deliveries` |

`DomainError` coi là vĩnh viễn: vi phạm invariant là tất định, thử lại cũng ra đúng lỗi đó.
Group tạo với start id `0` (không phải `$`): group mới vẫn xử lý message đã có trong stream.

### 5. Kết nối Redis
- **Ghim `protocol: 2`.** ioredis 6 mặc định RESP3; chế độ tương thích của nó không giữ nguyên hình
  dạng mọi lệnh (XREADGROUP trả `[stream, entries]` thay vì `[[stream, entries]]`). Phát hiện bởi test
  tích hợp, không phải bởi typecheck.
- Lệnh gọi qua `redis.call('XADD', …)` trong một lớp `StreamClient` duy nhất, không qua overload của ioredis.
- Mỗi consumer một kết nối riêng (XREADGROUP BLOCK giữ kết nối). `lazyConnect` để process không dùng
  Redis (job `migrate`) không mở kết nối.

## Hệ quả
- Handler ở `modules/<x>/interface/consumers/` chỉ import `shared/streams/contracts.ts` (luật kiến trúc ép).
- Thứ tự chỉ bảo đảm trong một lượt relay; nhiều relay song song có thể xen kẽ giữa các lô. Consumer
  nào cần thứ tự theo aggregate phải tự kiểm (ví dụ bằng trạng thái trong DB), không dựa vào stream.
- Mất Redis: event vẫn nằm trong outbox; Redis sống lại thì relay gửi tiếp (có test).
