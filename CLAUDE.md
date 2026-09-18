# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Trao đổi với người dùng bằng tiếng Việt. Giữ tiếng Anh cho định danh trong code, log message và error message.

## Lệnh

```bash
npm run dev         # tsx watch src/index.ts
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm start           # node dist/src/index.js  (chạy sau khi build)
npm test            # vitest run
npx vitest run test/unit/transitions.test.ts   # chạy một file test
npx vitest -t "excluded THẮNG included"        # chạy một test theo tên
npm run db:generate # drizzle-kit generate -> drizzle/*.sql
npm run db:migrate  # cần DATABASE_URL trỏ tới MySQL đang chạy
```

Node 22 trên máy build hiện tại **không** có type stripping (`node file.ts` trả `ERR_NO_TYPESCRIPT`),
nên chạy từ source phải qua `tsx`, còn production chạy `dist/`. Import trong source dùng đuôi `.ts`
thật; `rewriteRelativeImportExtensions` đổi sang `.js` lúc emit — đừng đổi thành `.js` trong source.

## Stack đã chốt

TypeScript strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) ·
**MySQL 8** · Drizzle ORM · vitest. Redis Streams, Fastify và zod thuộc phase 1, chưa có trong repo.

`erasableSyntaxOnly` đang bật: **không dùng `enum`, `namespace`, hay parameter property** — enum khai
bằng mảng `as const` trong `src/shared/kernel/enums.ts`, vừa suy ra union type vừa đưa thẳng vào `mysqlEnum()`.

## Trạng thái: phase 0 đã xong, phase 1 chưa bắt đầu

Có trong repo: **domain model đầy đủ 10 module + schema MySQL + 2 migration (`0000_init_model_b`, `0001_rbac_account_fk`) + 55 unit test**.

Chưa có: HTTP server, DI container, repository, Redis, worker, scheduler, tầng `application/`
và `interface/` của mọi module. `src/index.ts` mới chỉ log bootstrap.

Thứ tự phase 1 (đã thống nhất): `shared/config` → `shared/db` (client + unit of work + outbox relay)
→ `shared/streams` → `entrypoints/{api,worker,scheduler}` → lát cắt dọc đầu tiên là module `apps`.
Chọn `apps` vì mọi bảng khác đều có `app_id`, và nó là cổng xác thực của `/v1/*`.

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
| `0011` | Composite FK chống cấp quyền chéo account trên `admin_app_roles` |

`Workflow Notification Service - Final.docx` là nghiên cứu OneSignal, không phải quyết định.

## Cấu trúc

```
src/shared/kernel/     ids (branded) · enums · errors · result · clock · email · base-entity
src/shared/db/         columns dùng chung · outbox · processed_messages
src/modules/<name>/
  domain/              CẤM import Drizzle, MySQL, HTTP, application, infrastructure
    entities/          class entity, mỗi file 1 entity + interface `XxxProps` của nó
    rules/             hàm thuần: state machine, pipeline, gate, resolver — kèm kiểu I/O của hàm
    types/             value object / kiểu dùng chung giữa nhiều file hoặc với infrastructure
  application/         ports/ · commands/ · queries/ · dto.ts (phase 1)
  infrastructure/db/   schema.ts — bảng mà module này sở hữu; adapters/ hiện thực port
  interface/           http/ · consumers/ · jobs/ (phase 1)
```

**Domain không khai port.** Rule nào cần dữ liệu từ DB thì nhận dữ liệu đã tra sẵn làm tham số;
interface kiểu repository/lookup đặt ở `application/ports/`. Ví dụ: `identityKeys()` →
application tra qua `PersonLookup` → `resolveIdentity(keys, matches)`.

10 module: `tenancy` · `apps` · `directory` · `subscriptions` · `topics` · `segments` ·
`templates` · `notifications` · `delivery` · `audit`.

Khác tài liệu A ba chỗ (ADR-0006): thêm `tenancy` (org/admin), thêm `segments` (giữ pipeline giải
người nhận), `topics` thu lại chỉ còn consent.

**Dependency rule:** `domain` chỉ biết `shared/kernel`. `infrastructure` hiện thực port và là nơi
duy nhất biết SQL. Module A cần module B thì đi qua port + adapter, không query bảng của B.
Ngoại lệ duy nhất đã duyệt là ADR-0010.

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
- **Entity nhận một object props**; service sẽ nhận một bag dependency. Đây là hình dạng DI container
  phase 1 sẽ wire.
- **Barrel `index.ts`** ở mọi thư mục; thêm file là thêm export.
- **Domain không import Drizzle.** Entity và bảng là hai thứ khác nhau, nối bằng mapper ở
  `infrastructure` (mapper sẽ viết ở phase 1).

## Ngôn ngữ

Comment trong code và tài liệu viết bằng tiếng Việt; định danh, log message và error message viết
bằng tiếng Anh. Giữ đúng quy ước này khi sửa code.
