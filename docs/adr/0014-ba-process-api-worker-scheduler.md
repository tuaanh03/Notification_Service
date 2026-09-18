# ADR-0014 — Ba process: api, worker, scheduler

**Trạng thái:** chấp nhận — 2026-09-18. Hiện thực tài liệu kiến trúc §2 ("1 image, 3 lệnh chạy").

## Quyết định

| Process | Entrypoint | Việc | Scale |
| --- | --- | --- | --- |
| `api` | `entrypoints/api/` | Fastify: nhận HTTP → command → DB + outbox → response. Không gửi mail, không XADD thẳng. | N bản sau load balancer |
| `worker` | `entrypoints/worker/` | Chạy consumer group theo `WORKER_GROUPS` (`all` hoặc danh sách). Mỗi group một `StreamConsumer.run`. | N bản; tách riêng group nặng bằng `WORKER_GROUPS` |
| `scheduler` | `entrypoints/scheduler/` | `JobRunner`: relay outbox (1 s), dọn outbox > 7 ngày và processed_messages > 14 ngày (1 giờ). | 1 bản là đủ; nhiều bản vẫn an toàn (SKIP LOCKED, DELETE idempotent) |

Cùng một image, khác `command`. **Mỗi process một folder** (sửa 2026-09-18, trước đó 10 file nằm phẳng):
`<process>/main.ts` là file chạy — 3 dòng: dựng container → `runProcess` → `start<Process>`, không ai được
import; `<process>/start-<process>.ts` là logic khởi động/tắt, test gọi trực tiếp; `runtime/` là vòng đời
chung. Luật kiến trúc ép đúng khuôn này và cấm file nằm phẳng ở gốc `entrypoints/`.

### Vòng đời chung (`entrypoints/runtime/lifecycle.ts`)
start → chạy → SIGTERM/SIGINT → `stop()` (việc dở chạy nốt) → `container.dispose()` → exit 0.
Start lỗi → exit 1. Tắt quá 12 s → exit 1 (compose `stop_grace_period` 15 s). Lỗi không ai bắt →
tắt có trật tự, exit 1. Process được giữ sống tới khi có tín hiệu tắt — test phát hiện worker chưa có
consumer nào từng tự thoát mã 0 ngay sau khởi động (sẽ bị restart vô hạn).

### api
- `/health/live` (process sống) và `/health/ready` (ping MySQL + Redis; 503 khi đang tắt để load
  balancer ngừng dồn request). Healthcheck của compose gọi `/health/ready`.
- Mọi lỗi → `application/problem+json` (RFC 9457) qua `toProblem`: `ValidationError` 422 kèm `issues`,
  `InvalidId` 400, `CrossOrg/CrossAccount` 403, `InvalidTransition/ConcurrentTransition` 409, lỗi lạ 500
  với câu chung chung (chi tiết chỉ vào log). Mỗi response có `x-request-id`.
- Tắt: `Connection: close` gắn ở `onSend` khi đang tắt — nếu không, kết nối keep-alive của request đang
  dở làm `close()` treo tới hết keep-alive timeout (test phát hiện).

### Khác tài liệu gốc
- **XAUTOCLAIM/nhận lại message treo nằm trong worker**, không ở scheduler: chỉ worker có handler để
  xử lý message nhận lại (ADR-0013).
- Cổng host mặc định của compose là **4002** (theo §2 tài liệu); trong container vẫn là 3000.

## Điểm mở rộng
- Route: `startApi(container, { routes })` — module đăng ký `HttpRoutes` từ `interface/http/`.
- Consumer: một dòng trong `composition/consumer-registry.ts`.
- Job định kỳ (ví dụ `promote-scheduled`): một phần tử trong `composition/scheduler-jobs.ts`.
