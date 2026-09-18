# ADR-0012 — DI theo port: transaction qua AsyncLocalStorage, composition root viết tay

**Trạng thái:** chấp nhận — 2026-09-18.

## Bối cảnh
Sau lượt 1 của phase 1, kiểm tra kiến trúc cho thấy:

- `UnitOfWork.run(tx => ...)` để lộ kiểu `Transaction` của Drizzle — command ở tầng application sẽ
  phải import kiểu của hạ tầng.
- `appendToOutbox(tx, …)` là hàm tự do, không có interface để tiêm.
- Interface `Logger` nằm chung file với pino.
- Domain tự lấy giờ bằng `new Date()` ở 15 chỗ; dùng `Buffer` của Node.
- Schema `apps` ↔ `tenancy` import vòng.
- Không có gì ép dependency rule ngoài kỷ luật người viết.

## Quyết định

### 1. Port hạ tầng dùng chung ở `src/shared/application/ports/`
Thuần interface, không import gì ngoài chính nó:

| Port | Hiện thực (`shared/db`) |
| --- | --- |
| `UnitOfWork { run(work: () => Promise<T>) }` | `DrizzleUnitOfWork` |
| `EventOutbox { append(events) }` | `DrizzleEventOutbox` (stream do `StreamRouter` tiêm vào quyết định) |
| `Logger` (`shared/observability/logger.ts`) | `createPinoLogger` (`pino-logger.ts`) |
| `Clock` (`shared/kernel/clock.ts`) | `systemClock` |

### 2. Transaction đang mở giữ trong `AsyncLocalStorage` (`TransactionContext`)
Port không mang tham số `tx`. Adapter nhận `TransactionContext` qua constructor và hỏi:
`executor()` (tx nếu đang mở, không thì db) hoặc `require(op)` (bắt buộc có tx — outbox,
processed_messages, khoá dòng). `run` lồng nhau nhập vào transaction ngoài, không SAVEPOINT.

Phương án bị loại: truyền một `TxScope` mờ vào `work` — mọi port repository sẽ phải nhận thêm tham
số đó, lộ khái niệm transaction lên tầng application.

Cái giá: cơ chế ngầm. Giới hạn nó bằng cách chỉ `TransactionContext` biết ALS tồn tại; test tích hợp
chứng minh hai `run` song song không lẫn transaction.

### 3. Composition root viết tay (`src/composition/container.ts`)
Không dùng thư viện DI (không decorator, không reflection). `createContainer(env, overrides)` trả
`ports` (thứ application được thấy) và `infra` (chỉ adapter / khung consumer / entrypoint).
Chỉ entrypoint được import composition root.

### 4. Thời gian là tham số
Domain và kernel không gọi `new Date()` / `Date.now()`. `TimestampInput.createdAt` bắt buộc,
`touch(at)` bắt buộc; application truyền `clock.now()`.

### 5. Luật kiến trúc thành test (`test/architecture/dependency-rules.test.ts`)
Chạy cùng `npm test`, gọi riêng bằng `npm run lint:arch`. Viết tay thay vì dependency-cruiser vì
TypeScript 7 (bản native) không còn JS API cho công cụ phân tích bên ngoài. Luật: domain chỉ biết
kernel (+ADR-0010), application không biết hạ tầng, xuyên module ở infrastructure chỉ
`schema.ts -> schema.ts`, shared không biết modules, chỉ entrypoint import composition, pino chỉ dựng
ở composition, không vòng phụ thuộc, domain không tự lấy giờ và không dùng global của Node.

## Hệ quả
- Command ở lượt 4 viết `await uow.run(async () => { … })` và chỉ thấy port.
- Thêm port mới = interface ở `application/ports/` + hiện thực ở `infrastructure/` + một dòng
  wiring trong composition root.
