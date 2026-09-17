# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Trao đổi với người dùng bằng tiếng Việt. Giữ tiếng Anh cho định danh trong code, log message và error message.

## Lệnh

```bash
npm start     # node src/index.js
npm run dev   # node --watch src/index.js
```

Không có bước build, linter, test runner hay dependency nào — `package.json` không khai cả `dependencies` lẫn `devDependencies`. ESM thuần (`"type": "module"`) trên Node >= 20, chỉ dùng builtin `node:`. Cấu hình chỉ qua env (`.env.example`: `NODE_ENV`, `PORT`, `LOG_LEVEL`); chưa có gì đọc `.env` (không có dotenv), nên phải export biến ngoài shell.

## Đọc phần này trước khi sửa bất cứ thứ gì: code lệch với thiết kế

Repo đang ở trạng thái **code mới là scaffold mỏng, còn `docs/` đi trước rất xa**. `src/index.js` tạo logger, log `bootstrap`, rồi dừng ở `// TODO: infrastructure -> container -> server`. Chưa có HTTP server, DB, queue hay DI container.

`docs/EWS-Backend-Architecture.docx` (v1, 15/09/2026) là kiến trúc chuẩn — tên các `src/modules/*` và comment header của chúng chép nguyên văn từ §2 của tài liệu này. Nó chỉ định một stack mà scaffold **chưa** dùng:

| Tài liệu chỉ định | Scaffold hiện có |
| --- | --- |
| TypeScript 5 strict, pnpm 9, Node 22 | JS ESM thuần, npm, Node >= 20 |
| Fastify 5 + zod `contracts/`, Drizzle ORM, PostgreSQL 16, Redis 7 Streams, liquidjs, pino, argon2 | không dependency nào |
| `src/entrypoints/{api,worker,scheduler}.ts`, `infrastructure/` + `interface/` trong từng module, `contracts/` ở gốc, `test/` | `src/index.js`, chỉ có `domain/` + `application/` |
| `shared/{kernel,auth,db,streams,rate-limit,config,observability,http}` | `shared/{domain,helpers,interfaces}` |
| vitest + testcontainers, ESLint `import/no-restricted-paths` | không test, không lint |

Coi khoảng cách này là **quyết định còn treo, không phải lỗi cần tự sửa**: hỏi người dùng trước khi đưa TypeScript, framework, ORM hay bất kỳ dependency nào vào. Chưa có gì trong code cho thấy bên nào thắng — scaffold JS đơn giản hay stack trong tài liệu.

### Hai mô hình dữ liệu trong `docs/` mâu thuẫn nhau

- **Mô hình A** — `EWS-Backend-Architecture.docx` §4/§9 + `docs/ERD.drawio` (3 trang, app.diagrams.net). `users` toàn cục + `user_identities`, `topics` / `topic_bindings` / `topic_preferences`, `notifications` với enum 11 trạng thái, `send_approvals`, `audit_log`. **Đây là thứ `src/modules/*` đang dựng theo.**
- **Mô hình B** — `Schema-Notification-Service-formatted.docx` + `Notification Service-BusinessProblem.md` (2026-09-17, mới hơn). Thêm `accounts` → `organizations` → `apps` → `persons`, scope user theo app (`UNIQUE(app_id, external_id)`), thay topic binding bằng `segments` + `messages` + `message_segments`, thêm `user_aliases`, Identity Resolver gộp theo `persons.primary_email` (chỉ deterministic, không bao giờ probabilistic), `opted_out_optional`, `manage_token`, suppression bounce scope theo tenant, và rate limit theo app.

Mô hình B chưa có gì tương ứng trong code. Hỏi mô hình nào là chuẩn trước khi thiết kế entity, repository hay migration — không tự ý trộn hai mô hình.

`Workflow Notification Service - Final.docx` là nghiên cứu OneSignal (nền tham khảo cho biến template, tag vs RBAC, deltas, import CSV), không phải quyết định thiết kế.

## Cấu trúc code hiện tại

```
src/shared/          BaseEntity, Result, EventId, createLogger,
                     và các "interface" dạng abstract: IRepository, IUnitOfWork, ILogger, IService
src/modules/<name>/
  domain/            entity kế thừa BaseEntity; không dính framework/ORM; vi phạm invariant thì throw
  application/
    dtos/            Request DTO có validate() -> string[]; Response DTO có static fromEntity()
    interfaces/      I<Name>Repository extends IRepository — port mà module cần
    services/        <Name>Service extends IService — điều phối; trả Result, không throw
```

Chỉ `modules/directory` có code thật (`User`, `UserService`, `UserDto`). Bảy module còn lại là khung rỗng: một subclass `BaseEntity` chỉ `Object.assign(this, props)`, một `I*Repository` rỗng, và `dtos/` với `services/` chỉ có comment. **Dùng `modules/directory` làm mẫu khi viết bất kỳ module nào khác.**

### Quy ước mà code hiện tại đang áp

- **Barrel file ở mọi nơi.** Mỗi thư mục có `index.js`, và barrel của mỗi lớp re-export lớp bên dưới. Import qua barrel (`from '../../../../shared/index.js'`), không đi đường sâu. Thêm file là phải thêm export vào barrel.
- **Result thay cho exception ở biên service.** `Result.ok(v)` / `Result.fail({ code, message })`, dùng qua `.match({ ok, fail })`; gọi `.value` trên Result lỗi sẽ throw. Code lỗi hiện có: `VALIDATION`, `NOT_FOUND`. Ngược lại, entity trong domain **có** throw khi vi phạm invariant (`User.rename`).
- **Interface là abstract class**, method chưa hiện thực thì throw `<ClassName>.<method> not implemented`. Port của module cứ để rỗng cho tới khi cần thêm method.
- **Constructor nhận object destructuring + field `#` private.** Service nhận một bag dependency (`constructor({ userRepository, logger })`); entity nhận một object props. Đây chính là hình dạng mà DI container sau này sẽ wire.
- **ID sinh ở tầng service bằng `EventId.generate()`**, không phải từ DB hay entity. (Tài liệu về sau yêu cầu UUID v7; `EventId` hiện là `randomUUID`, tức v4.)
- **Validate nằm trong request DTO**, không nằm trong service: service dựng DTO, gọi `validate()`, mảng lỗi khác rỗng thì trả `VALIDATION`.
- **Logger được inject**, không import thẳng trong service; dùng `logger.child('ctx')` để phân scope.

## Kiến trúc đích (theo EWS-Backend-Architecture.docx)

Modular monolith, một image, ba process: `api`, `worker`, `scheduler`. PostgreSQL là nguồn sự thật duy nhất; Redis Streams chỉ là hàng đợi at-least-once và event bus, không bao giờ giữ trạng thái nghiệp vụ.

**Dependency rule (tài liệu ghi: review chặn nếu vi phạm):** `domain` chỉ import shared kernel, không biết DB/Redis/HTTP tồn tại. `application` import `domain` + port của chính nó, không import `infrastructure`. `infrastructure` hiện thực port và là nơi duy nhất biết SQL, stream, SMTP. `interface` (HTTP/consumer/job) chỉ parse input → gọi command/query → map output, không có `if` nghiệp vụ. Module A cần module B thì khai port trong `A/application/ports` và adapter trong `A/infrastructure/adapters` gọi `B.application`; cấm import `B/infrastructure`, cấm query bảng của B.

**Module ↔ use case ↔ bảng sở hữu:**

| module | UC | sở hữu |
| --- | --- | --- |
| `apps` | UC-001 | `apps`, `app_secrets`, `app_network_rules`, `app_approvals` |
| `directory` | UC-002 | `users`, `user_identities`, `user_tags`, `user_metrics`, `user_events`, `user_merges`, `directory_imports(+_rows)`, `directory_sync_runs` |
| `subscriptions` | UC-007 | `subscriptions`, `topic_preferences`, `unsubscribe_tokens` |
| `topics` | UC-002 | `topics`, `topic_bindings`, `topic_estimate_cache` — sở hữu pipeline giải người nhận |
| `templates` | UC-006 | `templates`, `template_versions`, `template_bindings` |
| `notifications` | UC-005/008 | `notifications`, `notification_recipients`, `notification_transitions`, `send_approvals` — sở hữu state machine |
| `delivery` | UC-005 E5 | `delivery_batches`, `bounce_events` |
| `audit` | SM-9 | `audit_log` (append-only) |

Cộng thêm hai bảng dùng chung: `outbox` và `processed_messages`.

### State machine notification — invariant trung tâm

11 trạng thái; lằn ranh là `queued -> sending` ("đã có email nào rời hệ thống chưa?"). Huỷ chỉ hợp lệ ở `queued`, Dừng chỉ hợp lệ ở `sending`. Bảng chuyển trạng thái là một hằng số duy nhất trong `notifications/domain/transitions.ts` và mọi command đều đi qua `transition()` — không ai set `status` trực tiếp.

```
draft            -> submit: queued | submit_over_threshold: pending_approval | schedule: scheduled
pending_approval -> approve: queued | reject: draft
scheduled        -> due: queued | unschedule: draft | cancel: cancelled
queued           -> first_batch_left: sending | cancel: cancelled | zero_recipients: no_recipient | fail: failed
sending          -> all_accepted: sent | some_failed: partially_failed | stop: stopped | all_failed: failed
```

Sáu trạng thái kết thúc không có dòng đi ra — không quay lui (SM-2) và không có endpoint thu hồi (BR-12); gửi lại hay đính chính là một bản ghi **mới** với `parent_notification_id`.

Ba lớp bảo vệ: (1) domain từ chối chuyển trạng thái sai; (2) repository ghi bằng `UPDATE ... WHERE id=? AND status=:expected` nên Huỷ và `first_batch_left` không thể cùng thắng — `rowCount = 0` nghĩa là 409 với người bấm, hoặc XACK im lặng với worker; (3) một dòng `notification_transitions` được insert **trong cùng transaction** với lần đổi trạng thái, cùng với các dòng `outbox`. Riêng Dừng còn set cờ Redis `halt:notif:{id}` mà delivery consumer kiểm tra trước mỗi lô.

Những thứ **không** phải trạng thái dù trông giống: duplicate (unique `(app_id, idempotency_key)` → trả lại bản ghi cũ với **200**, không phải 202), collapsed (`occurrence_count++`), test send (cột `is_test`), `origin` (`api` | `dashboard`), directory quá hạn (cột cờ).

### Giải người nhận — một pipeline, hai chế độ

`modules/topics` sở hữu nơi duy nhất tính số người nhận: `resolve(topicKey, { mode })`, trong đó `estimate` (lúc soạn, lúc hẹn giờ) chỉ đếm và cache ~60s, còn `snapshot` (tại lối vào `queued`) mới ghi `notification_recipients`. Năm bước: lấy binding included → bung role/group qua Directory resolver (snapshot quá hạn thì set `stale_directory`) → gộp trùng theo `user_id` → trừ excluded + opt-out (**excluded thắng included**) → map sang subscription active khớp default channel của topic. Mỗi người bị loại đều ghi `exclusion_reason` (`duplicate`, `excluded`, `opted_out`, `invalid`, `no_channel`).

### Cơ chế hàng đợi

Command không bao giờ `XADD` trong transaction của nó — nó ghi vào `outbox`, rồi scheduler relay (`FOR UPDATE SKIP LOCKED` → XADD → set `published_at`). Consumer chỉ ACK sau khi đã commit DB, idempotent nhờ `processed_messages (consumer_group, message_id)`, đẩy lỗi vĩnh viễn sang `<stream>.dlq` còn lỗi tạm thì không ACK để `XAUTOCLAIM` giao lại. Các stream: `notif.queued`, `delivery.email`, `delivery.in_app`, `delivery.result`, `directory.{tags,import,sync}`, `audit.events`.

### Business rule bắt buộc chặn ở backend

Frontend đang bảo vệ các rule này bằng hình dạng UI; curl thì đi vòng qua được. Nặng ký nhất: không có ô nhập người nhận tự do (người nhận chỉ đến từ `topic_key` + binding; body `.strict()` từ chối field lạ) · số người nhận lúc soạn chỉ là *ước lượng*, snapshot thật chỉ xảy ra ở `queued` · khoá nút gửi cho tới khi đã render preview và không còn sót `{{ }}`, và ba con số xác nhận phải khớp với lần tính lại ở server (lệch → 409) · `no_recipient` là trung tính ở API (202 rồi chuyển `no_recipient`), còn đường dashboard thì chặn ở 422 kèm `exclusions[]` · 202 nghĩa là đã nhận, không phải đã tới hộp thư · hard bounce đánh subscription thành `invalid`, không bao giờ là `unsubscribed` · footer unsubscribe do hệ thống chèn, template tự viết link thì publish fail 422 · `GET /u/:token` chỉ render, `POST` mới đổi trạng thái · app secret chỉ hiện một lần (DB giữ argon2 hash + hint, tối đa 2 active) · không xoá cứng `notifications`, `notification_recipients`, `audit_log` · RBAC nằm ở một chỗ duy nhất và tag `role:*` **không bao giờ dùng để kiểm tra quyền** — tag chỉ để phân đoạn.

## Ngôn ngữ

Comment trong code và toàn bộ tài liệu thiết kế viết bằng tiếng Việt; định danh, log message và error message viết bằng tiếng Anh. Giữ đúng quy ước này khi sửa code.
