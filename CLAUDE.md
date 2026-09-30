# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Trao đổi với người dùng bằng tiếng Việt. Giữ tiếng Anh cho định danh trong code, log message và error message.

## Lệnh

```bash
cp .env.example .env # lần đầu — `.env` bị git bỏ qua; giá trị bí mật chỉ đặt ở đây
npm run dev         # tsx watch --env-file-if-exists=.env src/entrypoints/api/main.ts   (cần `docker compose up -d mysql redis`)
npm run dev:worker  # như dev, với src/entrypoints/worker/main.ts
npm run dev:scheduler  # như dev, với src/entrypoints/scheduler/main.ts
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm start           # node dist/src/entrypoints/api/main.js  (start:worker / start:scheduler tương tự)
npm test            # unit + luật kiến trúc — không cần Docker, < 3 giây
npm run lint:arch   # chỉ luật kiến trúc (test/architecture/)
npm run test:integration  # MySQL 8.4 thật qua testcontainers — CẦN Docker, ~1 phút
npm run test:all    # tất cả
npx vitest run test/unit/transitions.test.ts   # chạy một file test
npx vitest -t "excluded THẮNG included"        # chạy một test theo tên
npm run db:generate # drizzle-kit generate -> drizzle/*.sql
npm run db:migrate  # tsx --env-file-if-exists=.env src/entrypoints/migrate/main.ts — cần DATABASE_URL
npm run db:migrate:prod   # bản đã build, chính là lệnh job `migrate` trong compose
npm run email:test -- ban@company.com   # gửi MỘT thư thử qua EMAIL_PROVIDER đang cấu hình (đọc .env)

docker compose up --build   # mysql + redis + migrate + api (:4002) + worker + scheduler
docker compose exec api node dist/src/entrypoints/admin-cli/main.js create-admin --email ban@company.com --account-name "EWS"
npx tsx --env-file-if-exists=.env src/entrypoints/admin-cli/main.ts list-accounts   # bản chạy từ source
docker compose up -d --scale worker=3   # thêm worker
docker compose up -d mysql redis # chỉ hạ tầng, để chạy `npm run dev` trên máy
```

Node 22 trên máy build hiện tại **không** có type stripping (`node file.ts` trả `ERR_NO_TYPESCRIPT`),
nên chạy từ source phải qua `tsx`, còn production chạy `dist/`. Import trong source dùng đuôi `.ts`
thật; `rewriteRelativeImportExtensions` đổi sang `.js` lúc emit — đừng đổi thành `.js` trong source.

## Stack đã chốt

TypeScript strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) ·
**MySQL 8** · Drizzle ORM (driver `mysql2`) · **Redis 7 Streams** (ioredis 6, ghim RESP2) · zod (env)
· Fastify 5 · pino · vitest + testcontainers · Docker (`node:22-slim`, compose có MySQL 8.4 + Redis 7.4).

`erasableSyntaxOnly` đang bật: **không dùng `enum`, `namespace`, hay parameter property** — enum khai
bằng mảng `as const` trong `src/shared/kernel/enums.ts`, vừa suy ra union type vừa đưa thẳng vào `mysqlEnum()`.

## Trạng thái: phase 1 xong · MVP email: xong GĐ 4/4

**Đang làm MVP gửi email trực tiếp qua Microsoft Graph — đọc `implementation_plan.md` và ADR-0016
trước khi code.** Phạm vi đã rút gọn: chỉ email, gửi từng người theo `external_id`, at-most-once,
nội dung trực tiếp (chưa template), consent kiểm ở worker. Xong GĐ 0 (nền), GĐ 1 (user + email),
GĐ 2 (topic + preference), GĐ 3 (gửi end-to-end bằng `MockEmailProvider`), GĐ 4 (provider
Microsoft Graph + giới hạn tốc độ trên Redis — ADR-0018). Đang làm mục 12 "Sau MVP" của plan:
`templates` (ADR-0020) — xong GĐ 1 (admin soạn / xuất bản) và GĐ 2 (app gửi bằng `templateId` +
`payload`), tiếp theo GĐ 3 (nối console).

Có trong repo: domain model 10 module · schema MySQL + 7 migration · hạ tầng dùng chung (config, db,
streams, http, jobs) · 3 process `api` / `worker` / `scheduler` · luật kiến trúc thành test · Docker.
**Ba module đã có lát cắt dọc đầy đủ** (application + infrastructure + interface):

| Module | Có gì |
| --- | --- |
| `tenancy` | tạo account / organization; query `FindOrganization` cho module khác |
| `directory` | đồng bộ user theo `external_id` + email trong một transaction; `FindUserByExternalId` cho module khác; `GET /admin/apps/:appId/users` (danh sách người nhận, phân trang + tìm) và `GET /admin/apps/:appId/users/:externalId` (một người, khớp đủ mã — cùng `FindUserByExternalId.get` với `/v1`) |
| `subscriptions` | email của user (tạo / đổi / ngắt / bật lại theo luật plan §5), cờ L1 `optedOutOptional`; `FindUserEmail` cho module khác — chưa có route riêng |
| `topics` | admin tạo / kích hoạt / đình chỉ topic (chỉ admin đặt `mandatory`); `GET /v1/topics`; `GET/PUT /v1/users/:externalId/preferences` (L1 + L3, kiểm hết rồi mới ghi); `GET /admin/apps/:appId/users/:externalId/preferences` (chỉ đọc); `ConsentQueries` cho module khác |
| `notifications` | `POST/GET /v1/notifications` (202 queued, idempotency; nội dung viết thẳng HOẶC `templateId` + `payload`, đổ biến lúc nhận); `GET /admin/apps/:appId/notifications` (lịch sử gửi, chỉ đọc, không kèm địa chỉ / nội dung); `GET /admin/apps/:appId/overview` (số liệu màn Tổng quan: 24 giờ gần nhất + hàng chờ, chỉ con số); worker `email-sender` gửi AT-MOST-ONCE (gate L0/L1/L3 lúc gửi -> tx1 nhận việc -> provider ngoài transaction -> tx2 kết quả); job `fail-stuck-sending` |
| `delivery` | port `EmailProvider` (kết quả phân loại accepted / retryable / rejected / unknown), `SendEmail` thử lại chỉ khi chắc chắn chưa gửi, `GraphEmailProvider` + `MockEmailProvider` (chọn bằng `EMAIL_PROVIDER`), port `SendRateLimiter` (`EMAIL_MAX_PER_MINUTE`, đếm chung trên Redis) |
| `apps` | vòng đời app (UC-001), API key (cấp / thu hồi, ≤ 2 active), allowlist IP/Origin, xác thực `/v1/*` |
| `audit` | consumer `audit-writer` (`audit.events` -> `audit_log`), `GET /admin/audit` |
| `templates` | admin tạo / đổi tên / lưu nháp / tạo nháp từ bản cũ / xuất bản / lưu trữ dưới `/admin/apps/:appId/templates` (ADR-0020); tối đa 1 nháp + 1 published mỗi template, khoá dòng `templates` trước mọi lệnh ghi; kiểm tra nội dung chạy lúc xuất bản; `RenderTemplate` (đổ `payload` vào bản đang xuất bản) + `TemplateQueries.labelsOf` cho module khác |

`segments` mới có domain + schema (ngoài phạm vi MVP). `/admin/*` dùng **phiên đăng nhập admin**
(`/auth/login` -> token mờ lưu băm trong `admin_sessions`); admin đầu tiên tạo bằng `admin-cli` chạy trong
container, KHÔNG qua HTTP (ADR-0019 thay §4 của ADR-0015).

Phase 1 làm theo 4 lượt, mỗi lượt dừng để người dùng review:
1. ~~`shared/config` + `shared/db` + test tích hợp~~ — xong (kèm chuẩn hoá DI + Docker)
2. ~~`shared/streams` + outbox relay~~ — xong
3. ~~`entrypoints/{api,worker,scheduler}` chạy lâu dài~~ — xong
4. ~~lát cắt dọc `apps` (+ tenancy tối thiểu, audit consumer)~~ — xong

## Tài liệu và quyết định

`docs/` có hai mô hình dữ liệu mâu thuẫn. **Đã phân xử — đọc `docs/adr/` trước khi đọc `docs/*.docx`**,
vì ADR ghi đè tài liệu ở những chỗ khác nhau:

| ADR | Nội dung |
| --- | --- |
| `0002` | **MySQL thay vì PostgreSQL** — ghi đè ADR-0002 trong `EWS-Backend-Architecture.docx` |
| `0005` | TypeScript, và lý do chính là branded id |
| `0006` | Lõi danh tính lấy mô hình B, vòng đời gửi ghép từ mô hình A |
| `0007` | Ba phân xử đặt tên (`notifications` thắng `messages`, `channel`+`value`, `status` enum) |
| `0008` | Chuẩn hoá email: không strip `+tag` |
| `0009` | Ràng buộc nào MySQL không ép được, phải ép ở command |
| `0010` | Ngoại lệ dependency rule cho `channelGate` và `effectiveOptIn` |
| `0011` | Composite FK chống cấp quyền chéo account trên `admin_app_roles` (bảng thuộc module `apps`) |
| `0012` | DI theo port: transaction qua AsyncLocalStorage, composition root viết tay, luật kiến trúc thành test |
| `0013` | Redis Streams: outbox relay, khung consumer, DLQ, khử trùng theo outbox id, ghim RESP2 |
| `0014` | Ba process api / worker / scheduler: vòng đời, health, problem+json, điểm mở rộng |
| `0015` | Lát cắt apps: `ModuleDefinition` cắm module vào process, 3 bề mặt HTTP, API key SHA-256, admin token tạm |
| `0016` | **MVP email trực tiếp**: Graph + Mock, at-most-once, `EmailContent`, consumer `idempotency: 'handler'`, bodyLimit theo route |
| `0017` | **READ COMMITTED** cho mọi connection — REPEATABLE READ phá mẫu "khoá rồi mới đọc" của ADR-0009 |
| `0018` | Provider Microsoft Graph (client credentials, phân loại kết quả) + giới hạn tốc độ gửi trên Redis, chờ lượt trước tx1 |
| `0019` | **Đăng nhập admin bằng phiên** (`admin_sessions`, token mờ + scrypt cho mật khẩu), bỏ `ADMIN_TOKEN`, admin đầu tiên tạo bằng `admin-cli` — **thay §4 của ADR-0015** |
| `0020` | **Template**: app gửi bằng `templateId` (bỏ `key`), tên không trùng trong app, không binding topic, đổ biến lúc API nhận request (qua `RenderTemplate`, worker không đổi), nháp lỏng / xuất bản chặt, lỗi template đều 422 |

`Workflow Notification Service - Final.docx` là nghiên cứu OneSignal, không phải quyết định.

`docs/huong-dan-tich-hop-cho-doi-app.md` là **hợp đồng với đội app** (route, body, mã lỗi `/v1`);
`docs/tich-hop-app-chi-tin-bat-buoc.md` là bản rút gọn của nó cho app chỉ có chủ đề bắt buộc.
Đổi route / body / mã lỗi ở `/v1` thì sửa CẢ HAI tài liệu đó VÀ `lib/api/v1-errors.ts` của console —
ba chỗ này không tự đồng bộ.

## Cấu trúc

```
src/
  entrypoints/             MỖI PROCESS MỘT FOLDER, cùng khuôn (luật kiến trúc ép):
    api/ · worker/ · scheduler/   main.ts (file CHẠY — không ai được import) · start-<process>.ts (test gọi) · index.ts
    migrate/                      main.ts (job một lần)
    send-test-email/              main.ts — `npm run email:test -- <địa chỉ>` gửi một thư thử qua provider đang cấu hình
    runtime/                      runProcess (vòng đời, SIGTERM) · loadEnvOrExit — dùng chung cho mọi process
                           Thứ riêng của một process (plugin HTTP...) đặt trong folder của process đó;
                           thứ tái dùng được thì ở shared/ hoặc composition/, không ở entrypoints/.
  composition/             COMPOSITION ROOT — nơi DUY NHẤT ghép hiện thực vào port. Chỉ entrypoint import.
                           container · module-definition · application (buildApplication = DANH SÁCH MODULE)
                           · modules/<x>.module.ts (ghép 1 module) · consumer-registry · scheduler-jobs
  shared/
    kernel/                ids (branded) · enums · errors · result · clock · email · base-entity — thuần, không I/O
    application/ports/     port hạ tầng dùng chung: UnitOfWork · EventOutbox — thuần interface
    observability/         logger.ts (port Logger) · pino-logger.ts (hiện thực, chỉ composition dựng)
    config/                loadEnv() — zod, fail-fast; không ai khác đọc process.env
    db/                    client (pool + UTC) · TransactionContext (ALS) · DrizzleUnitOfWork ·
                           DrizzleEventOutbox · ProcessedMessageStore · lockParentRow · errors · columns · schema
    streams/               names (stream + routeEvent) · contracts (StreamMessage, MessageHandler — thuần kiểu)
                           · codec · client (ioredis) · StreamClient · OutboxRelay · StreamConsumer
    http/                  buildHttpServer (3 bề mặt public/admin/v1, health, request id) · toProblem
                           · auth (AppCaller, AdminCaller, 2 interface authenticator) · parseInput (zod)
    jobs/                  JobRunner — job định kỳ không chồng lần, stop() chờ lần đang chạy
    rate-limit/            FixedWindowRateLimiter (Redis, cửa sổ 1 phút, dùng chung mọi process) — chỉ infrastructure import
  modules/<name>/
    domain/                CẤM import Drizzle, MySQL, HTTP, application, infrastructure, global của Node
      entities/            class entity, mỗi file 1 entity + interface `XxxProps` của nó
      rules/               hàm thuần: state machine, pipeline, gate, resolver — kèm kiểu I/O của hàm
      types/               value object / kiểu dùng chung giữa nhiều file hoặc với infrastructure
    application/           ports/ · commands/ · queries/ · dto.ts — chỉ thấy domain + port
    infrastructure/        db/schema.ts — bảng module này sở hữu; adapters/ hiện thực port
    interface/             http/ · consumers/ · jobs/ — parse input -> gọi command/query -> map output
test/
  unit/                    domain thuần, không DB
  architecture/            luật phụ thuộc (ADR-0012) — chạy cùng `npm test`
  integration/             MySQL + Redis thật; support/: global-setup, createTestDatabase(), testRedisUrl() /
                           createTestRedis() (MỖI FILE một db logic Redis riêng — tên stream là toàn cục,
                           dùng chung là worker file này lấy mất message file kia), http.ts (provisionApp), race()
Dockerfile · docker-compose.yml · .dockerignore
```

Chiều phụ thuộc (mũi tên = "được phép import"), ép bởi `test/architecture/dependency-rules.test.ts`:

```
entrypoints ─► composition ─► infrastructure (modules/*/infrastructure, shared/db, pino-logger)
                                   │
                                   ▼
                    application (modules/*/application, shared/application/ports, Logger port)
                                   │
                                   ▼
                    domain (modules/*/domain) ─► shared/kernel
```

**Domain không khai port.** Rule nào cần dữ liệu từ DB thì nhận dữ liệu đã tra sẵn làm tham số;
interface kiểu repository/lookup đặt ở `application/ports/`. Ví dụ: `identityKeys()` →
application tra qua `PersonLookup` → `resolveIdentity(keys, matches)`.

10 module: `tenancy` · `apps` · `directory` · `subscriptions` · `topics` · `segments` ·
`templates` · `notifications` · `delivery` · `audit`.

Khác tài liệu A ba chỗ (ADR-0006): thêm `tenancy` (org/admin), thêm `segments` (giữ pipeline giải
người nhận), `topics` thu lại chỉ còn consent.

**Dependency rule:** `domain` chỉ biết `shared/kernel`. `infrastructure` hiện thực port và là nơi
duy nhất biết SQL. Module A cần module B thì adapter của A gọi `application` của B, không query bảng
của B. Import xuyên module ở `infrastructure` chỉ được `schema.ts -> schema.ts` (để khai FK).
Ngoại lệ ở domain duy nhất đã duyệt là ADR-0010. Mọi luật này là test — vi phạm là `npm test` đỏ.

## Các hạt nhân nghiệp vụ

Đều là **hàm thuần, test được không cần DB**. Sửa ở đây là sửa hành vi cả hệ thống:

| File | Giữ rule gì |
| --- | --- |
| `notifications/domain/rules/transitions.ts` | Bảng 11 trạng thái. Vạch phân chia `queued -> sending`: Huỷ chỉ ở `queued`, Dừng chỉ ở `sending`. 6 trạng thái kết thúc không có đường ra — gửi lại là bản ghi MỚI với `parent_notification_id`. |
| `segments/domain/rules/resolution-pipeline.ts` | Nơi DUY NHẤT tính số người nhận. 7 bước, mỗi người bị loại ghi `exclusion_reason`. Hai chế độ `estimate` / `snapshot`. **Lọc trước, gộp sau**: kênh + L0/L1 xét từng user; excluded + L3 xét cả person; đại diện = user app SYS → subscription sớm nhất → `userId` nhỏ nhất. |
| `subscriptions/domain/rules/subscription-gate.ts` | Lớp L0 (kênh còn sống) và L1 (tắt tin không bắt buộc). |
| `topics/domain/rules/topic-consent.ts` | Lớp L3 (`effectiveOptIn`). Pipeline gọi thẳng hàm này — không viết lại L3 ở chỗ khác. |
| `directory/domain/rules/identity-resolver.ts` | Chỉ merge deterministic (email chuẩn hoá, phone đã OTP). Không tên, không ngày sinh, không fingerprint. |

**Ba ngoại lệ dễ code ngược nhất — có test cố định, đừng sửa mà không đọc test trước:**
- Topic `mandatory` bỏ qua lớp preference (L3) **và** lớp `opted_out_optional` (L1).
- Topic `mandatory` **KHÔNG BAO GIỜ** bỏ qua L0. Kênh chết là chết với mọi loại tin.
- `excluded` **thắng** `included` khi một người thuộc cả hai segment. Khi gộp theo person, một user
  của người đó bị excluded (hoặc tắt topic) là cả người bị loại.

Và một ranh giới của `subscriptions`: hard bounce / complaint → `status = 'invalid'`,
**không bao giờ** `'unsubscribed'`; app service không được tự `resubscribe` địa chỉ đã hard bounce.

## MySQL: những chỗ phải làm khác tài liệu

Chi tiết ở ADR-0002, ADR-0009 và ADR-0011. Những thứ hay quên nhất:

- **ID sinh ở application** (`shared/kernel/ids.ts`), lưu `CHAR(36)`. MySQL không có `gen_random_uuid()`.
- **`DATETIME(3)`, không dùng `TIMESTAMP`** (chết 2038 + tự đổi theo timezone session).
  Application **luôn ghi UTC**.
- **Không có partial index.** "Một published version mỗi template" mô phỏng bằng generated column
  `published_marker` + unique index. "≤ 2 secret active" **không** mô phỏng được — phải ép trong command,
  sau khi khoá **dòng cha** `apps ... FOR UPDATE` (khoá trên tập đang đếm chỉ ra gap lock — ADR-0009).
- **Hai composite FK trên `users`** (`fk_users_app_org`, `fk_users_person_org`) là lớp chống rò rỉ
  chéo org. Chúng cần `uq_apps_app_org` và `uq_persons_person_org` làm đích. InnoDB **cho phép** FK trỏ
  tới index không unique, nên nếu ai xoá hai unique đó vì tưởng thừa thì ràng buộc âm thầm yếu đi mà
  không báo lỗi. Đừng xoá.
- **Tên định danh ≤ 64 ký tự** (`ER_TOO_LONG_IDENT`). Tên FK Drizzle tự sinh
  (`<bảng>_<cột>_<bảng đích>_<cột đích>_fk`) rất dễ vượt — FK nào tên tự sinh dài quá thì khai bằng
  `foreignKey({ name: 'fk_...' })`. `test/integration/migrations.test.ts` chạy migration trên MySQL thật
  nên sẽ bắt lỗi này; `db:generate` thì **không** bắt.
- **Mức cô lập READ COMMITTED** (ADR-0017), đặt ở `shared/db/client.ts`. Đừng đổi về REPEATABLE READ
  mặc định: ở đó lệnh `SELECT` đầu tiên chốt snapshot, khoá xong vẫn đọc dữ liệu cũ — test race của
  `users-api.test.ts` sẽ đỏ. Cần giá trị không đổi giữa hai lần đọc thì khoá (`FOR UPDATE`).
- **Ba composite FK chống cấp quyền chéo account** (ADR-0011): `fk_apps_org_account`,
  `fk_admin_app_roles_admin_account`, `fk_admin_app_roles_app_account`. Đích bắt buộc:
  `uq_organizations_org_account`, `uq_admins_admin_account`, `uq_apps_app_account`. Cùng lý do — đừng xoá.

## Quy ước code

- **Branded id.** `OrgId`, `AppId`, `UserId`... đều là `string` có brand. Ép từ string ngoài vào bằng
  `AppId.parse(x)`, sinh mới bằng `AppId.create()`. Đừng dùng `as` để lách — brand tồn tại chính là để
  chặn truyền nhầm `org_id` vào chỗ `app_id`.
- **`Result` là union, không phải class.** `ok(v)` / `fail({code, message})`, narrow bằng `isSuccess`.
  Domain thì **throw** `DomainError` khi vi phạm invariant; application bắt lại và đổi thành `Result`.
- **Lỗi có `code` ổn định, `message` tiếng Anh.** `ValidationError` mang `Issue[]` (`code`, `message`,
  `path?`); một vi phạm thì dùng `ValidationError.of(code, message, path)`. Test và frontend so theo
  `code`, **không bao giờ** so theo chữ của `message`.
- **Cột nullable của DB mô hình bằng `null`**, không phải `undefined`. `exactOptionalPropertyTypes`
  đang bật nên props tuỳ chọn phải khai `?: T | undefined`.
- **Entity nhận một object props; class hạ tầng nhận một bag dependency** (`constructor(deps: { … })`).
  `erasableSyntaxOnly` cấm parameter property nên gán field tường minh trong constructor.
- **DI theo port (ADR-0012).** Application chỉ thấy interface: `UnitOfWork`, `EventOutbox`, `Logger`,
  `Clock`, và port của chính module. Hiện thực được ghép DUY NHẤT ở `src/composition/container.ts`
  (`ports` cho application, `infra` cho adapter/consumer/entrypoint). Thêm port = interface ở
  `application/ports/` + hiện thực ở `infrastructure/` + một dòng wiring.
- **Thời gian là tham số.** Domain/kernel không gọi `new Date()`/`Date.now()`: `createdAt` bắt buộc,
  mọi hàm đổi trạng thái nhận `at: Date`, application truyền `clock.now()`.
- **Barrel `index.ts`** ở mọi thư mục; thêm file là thêm export. Hai ngoại lệ có chủ đích: không có
  barrel gộp mọi module (`src/modules/index.ts` — mỗi bounded context vào qua barrel riêng), và
  `src/shared/index.ts` chỉ gồm kernel + port Logger để không ai kéo hạ tầng vào qua barrel.
- **Transaction: `await uow.run(async () => { … })`** — không có tham số `tx`. Mọi port gọi bên trong
  dùng CHUNG một transaction (giữ trong `TransactionContext`, AsyncLocalStorage). Adapter lấy
  executor bằng `transactions.executor()` (đọc) hoặc `transactions.require(op)` (bắt buộc trong tx:
  outbox, processed_messages, khoá dòng — gọi ngoài `run` ném `TransactionRequiredError`).
  `run` lồng nhau nhập vào transaction ngoài.
- **Bề mặt ĐỌC cho vận hành đặt dưới `/admin/apps/:appId/*`** (plan §5, ĐX-0004). `appId` trên URL
  chứ không suy từ token: bảng `admin_app_roles` (vai `app_admin`) đã có sẵn, nên khi làm RBAC
  (plan §12.4) chỉ cần thêm một lớp kiểm quyền trên chính tham số đó. Nhóm này **chỉ đọc** — admin
  không sửa consent hộ người dùng; app service tự ghi qua `/v1` bằng khoá của nó.
- **Đường `/admin` đọc nhiều bản ghi phải lấy dữ liệu liên quan theo LÔ.** `ListUsers` gọi
  `emails.findMany` (một truy vấn cho cả trang), `ListNotifications` gọi `recipients.findByNotifications`
  + `users.externalIds` + `topics.topicsByApp` (4 truy vấn mỗi trang), không gọi `find` từng dòng — màn danh sách mà
  bắn N+1 thì 200 người là 201 truy vấn. Cần lô xuyên module thì thêm một bản theo lô vào use
  case công khai của module kia (`FindUserEmail.executeMany`, `FindUserByExternalId.externalIdsOf`), đừng để adapter tự join sang bảng của nó.
- **Dữ liệu muốn vào `audit_log` phải nằm trong `before` / `after`.** `RecordAuditEntry` chỉ đọc
  `actor`, `source`, `before`, `after` của payload — field top-level khác bị **bỏ im lặng**, không
  lỗi, không cảnh báo. `TransitionApp` từng để `reason` ở top-level và lý do đình chỉ / thu hồi app
  rơi mất suốt; nay nằm trong `after`. Thêm field audit mới thì kiểm bằng test end-to-end qua worker
  thật (`test/integration/apps-api.test.ts`), đừng tin là nó tự tới.
- **Event ra ngoài module luôn qua `EventOutbox.append` trong `uow.run`** — không XADD thẳng. Event
  cần worker xử lý thì thêm một dòng vào `EVENT_ROUTES` (`shared/streams/names.ts`); mọi event đã tự
  vào `audit.events`.
- **Consumer = handler thuần `(message: StreamMessage) => Promise<void>`** đặt ở
  `modules/<x>/interface/consumers/`, chỉ import `shared/streams/contracts.ts`. Khung `StreamConsumer`
  lo idempotency (`dedupKey = outbox:<id>`, không phải message id Redis), transaction, ACK, retry, DLQ.
  Lỗi không thể khỏi khi thử lại -> ném `PermanentMessageError` (hoặc `DomainError`) để vào DLQ ngay.
  **Handler gọi dịch vụ ngoài** (gửi email) khai `idempotency: 'handler'`: khung không bọc transaction,
  không ghi `processed_messages`; handler tự chia transaction (commit "đã nhận việc" TRƯỚC khi gọi ra
  ngoài) và tự khử trùng bằng conditional update trên status (ADR-0016).
- **Thêm một lát cắt module** (ADR-0015), theo mẫu `apps`:
  1. `application/`: `ports/` (interface repository/lookup) · `commands/` (1 use case 1 class,
     `execute(input, ctx: CommandContext)`, bọc `uow.run`, ghi `outbox.append` với `audited(ctx, …)`)
     · `queries/` · `dto.ts` · `events.ts`.
  2. `infrastructure/adapters/`: repository Drizzle nhận `{ transactions }`, dùng `transactions.executor()`;
     mapper entity <-> dòng; cần module khác thì adapter gọi `application` của module đó.
  3. `interface/http/`: `xxxRoutes(useCases): HttpRoutes` — parse bằng `parseInput(zodSchema, …)`, dựng
     `CommandContext` từ `adminCaller`/`appCaller`, gọi use case, trả DTO. Path tương đối với bề mặt.
     `interface/consumers/`: `xxxHandler(useCases): MessageHandler`.
  4. `composition/modules/<x>.module.ts` trả `ModuleDefinition { http: { admin, v1, public }, consumers, jobs }`
     + một dòng trong `buildApplication`. Process api/worker/scheduler tự nhận, không sửa entrypoint.
- **Route/handler không bao giờ nhận `infra`** — chỉ use case (mà use case chỉ thấy port).
- **Biến môi trường** (không dùng dotenv): script `dev*` / `db:migrate` nạp `.env` bằng
  `--env-file-if-exists=.env` (biến export trong shell thắng file); compose đọc `.env` chỉ để thay
  `${...}`; `npm start` (production) không đọc file nào. Thêm biến = thêm vào schema `env.ts` VÀ
  `.env.example` — `test/unit/env-example.test.ts` đỏ nếu thiếu, nếu biến nhạy cảm có giá trị, nếu có
  giá trị trông như credential (GUID, chuỗi dài ngẫu nhiên) hoặc URL không phải localhost.
- **Giới hạn body mặc định 64 KB.** Route cần body lớn khai riêng `{ bodyLimit: LARGE_BODY_LIMIT_BYTES }`
  (512 KB — gửi email kèm HTML); không nới giới hạn cho toàn API.
- **Lỗi HTTP luôn là `application/problem+json`** qua `toProblem`. Route không tự `reply.status(4xx)`
  cho lỗi nghiệp vụ — ném `DomainError` / `ValidationError` và để error handler map.
- **Ràng buộc "tối đa N mỗi cha"**: `lockParentRow(transactions.require(...), bảng cha, PK, id)` rồi
  mới đếm (ADR-0009). Phải có test `race()` trong `test/integration/` chứng minh.
- **Domain không import Drizzle.** Entity và bảng là hai thứ khác nhau, nối bằng mapper ở
  `infrastructure` (mapper sẽ viết ở phase 1).

## Ngôn ngữ

Comment trong code và tài liệu viết bằng tiếng Việt; định danh, log message và error message viết
bằng tiếng Anh. Giữ đúng quy ước này khi sửa code.
