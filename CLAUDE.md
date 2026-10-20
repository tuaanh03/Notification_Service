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
docker compose exec api node dist/src/entrypoints/admin-cli/main.js create-admin --email ban@company.com --role super_admin --account-name "EWS"
docker compose exec api node dist/src/entrypoints/admin-cli/main.js create-admin --email nv@company.com --role user --login m365   # chỉ đăng nhập M365
docker compose exec api node dist/src/entrypoints/admin-cli/main.js set-member --org <orgId> --email nv@company.com --role owner   # ADR-0022
docker compose exec api node dist/src/entrypoints/admin-cli/main.js grant-app-role --app <appId> --email nv@company.com --role app_admin
docker compose exec api node dist/src/entrypoints/admin-cli/main.js scan-template-html   # CHẠY THỬ, chỉ đọc (ADR-0036)
docker compose exec api node dist/src/entrypoints/admin-cli/main.js purge-blocks-templates   # CHẠY THỬ; thêm --apply mới xoá (ADR-0037)
npx tsx test/unit/fixtures/compile-preset-html.ts ../ews-astrolink/node_modules/.pnpm/mjml-browser@4.18.0/node_modules/mjml-browser   # sinh lại HTML mẫu cho test (ADR-0037)
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
`templates` (ADR-0020) — xong cả 3 GĐ: admin soạn / xuất bản, app gửi bằng `templateId` + `payload`,
màn Templates của console đã đấu API.

Có trong repo: domain model 13 module · schema MySQL + 27 migration · hạ tầng dùng chung (config, db,
streams, http, jobs) · 3 process `api` / `worker` / `scheduler` · luật kiến trúc thành test · Docker.
**Ba module đã có lát cắt dọc đầy đủ** (application + infrastructure + interface):

| Module | Có gì |
| --- | --- |
| `tenancy` | tạo account / organization (người dùng tự tạo org và thành Owner — ADR-0025); query `FindOrganization` cho module khác; đồng bộ danh bạ M365 thành tài khoản + danh sách người để thêm vào org (ADR-0027); màn Danh bạ của Super Admin (`/admin/directory/people`) tích ai hiện khi thêm thành viên — người mới từ đồng bộ mặc định ẩn, thêm người chưa tích -> 422 `ADMIN_NOT_LISTED` |
| `directory` | đồng bộ user theo `external_id` + email trong một transaction; `FindUserByExternalId` cho module khác; `GET /admin/apps/:appId/users` (danh sách người nhận, phân trang + tìm) và `GET /admin/apps/:appId/users/:externalId` (một người, khớp đủ mã — cùng `FindUserByExternalId.get` với `/v1`); `POST /admin/apps/:appId/users` — người quản lý app THÊM TAY một người (`app.manage`, `source = 'console'`, mã đã có -> 409 `USER_ALREADY_EXISTS`, KHÔNG ghi đè như `/v1`); `DELETE /admin/apps/:appId/users/:externalId` — XOÁ MỀM (`users.deleted_at`): ẩn khỏi tra cứu / danh sách / phát vào chủ đề / đếm email, GIỮ lịch sử gửi và email; `PUT /v1/users` hoặc thêm tay cùng mã -> khôi phục cùng `user_id` |
| `subscriptions` | email của user (tạo / đổi / ngắt / bật lại theo luật plan §5), cờ L1 `optedOutOptional`; `FindUserEmail` cho module khác — chưa có route riêng |
| `topics` | admin tạo / kích hoạt / đình chỉ topic; đặt / bỏ `mandatory` lúc tạo hoặc sau (`PUT …/topics/:key/mandatory`) — người quản lý app (`app.manage`), không qua `/v1` (bổ sung ADR-0022); `GET /v1/topics`; `GET/PUT /v1/users/:externalId/preferences` (L1 + L3, kiểm hết rồi mới ghi); `GET /admin/apps/:appId/users/:externalId/preferences` (chỉ đọc); `ConsentQueries` cho module khác |
| `notifications` | `POST/GET /v1/notifications` (202 queued, idempotency; nội dung viết thẳng HOẶC `templateId` + `payload`, đổ biến lúc nhận); `POST/GET /v1/publications` (phát vào topic — ≤ 100 người đang theo dõi, mỗi người một notification con đi đúng đường gửi lẻ, `idempotencyKey` bắt buộc — ADR-0028); `GET /admin/apps/:appId/notifications` (lịch sử gửi, chỉ đọc, không kèm địa chỉ / nội dung); `GET /admin/apps/:appId/overview` (số liệu màn Tổng quan: 24 giờ gần nhất + hàng chờ, chỉ con số); màn Soạn thông báo của console gửi qua `POST /admin/apps/:appId/notifications` (≤ 20 người) / `…/publications` (cả chủ đề) — `SendFromConsole` gọi lại ĐÚNG `AcceptEmailNotification` / `PublishToTopic`, `origin = 'dashboard'`, `app.manage`, khoá chống trùng `console:<requestId>…`; `POST …/templates/:id/render` xem trước bằng `RenderTemplate`; worker `email-sender` gửi AT-MOST-ONCE (gate L0/L1/L3 lúc gửi -> tx1 nhận việc -> provider ngoài transaction -> tx2 kết quả), chèn ảnh đếm "đã mở" nếu app bật (ADR-0031); `GET /t/o/:notificationId/:sig.gif` (public, chữ ký HMAC, luôn trả cùng ảnh) -> `open_count` / `first_opened_at` (lịch sử gửi admin có, `/v1` không), lần mở đầu phát `NotificationOpened` -> webhook `notification.opened`; Tổng quan có `opens: { tracked, opened }` (mẫu số = cột `open_tracked`); `GET /admin/apps/:appId/open-tracking` (`{ enabled, ready }`); khung giờ gửi + dàn đều (ADR-0032): lúc nhận tính giờ gửi bằng `planSendTimes` (khung mở + lượt mỗi phút giữ trên Redis) -> `scheduled` + `scheduled_at`, job `promote-scheduled` thả về `queued` khi tới giờ; job `fail-stuck-sending` |
| `delivery` | port `EmailProvider` (kết quả phân loại accepted / retryable / rejected / unknown), `SendEmail` thử lại chỉ khi chắc chắn chưa gửi, `GraphEmailProvider` + `MockEmailProvider` (chọn bằng `EMAIL_PROVIDER`), port `SendRateLimiter` (`EMAIL_MAX_PER_MINUTE`, đếm chung trên Redis) |
| `apps` | vòng đời app (UC-001) — tự phục vụ: tạo xong là `active`, cấp sẵn `email` (`App.register`, ADR-0023), API key (cấp / thu hồi, có tên + "dùng lần cuối"; trần active = cài đặt hệ thống `apps.max_active_api_keys`, mặc định 20), allowlist IP (chỉ Super Admin khai; không còn Origin), cờ đếm "đã mở" `PUT …/open-tracking` (`app.manage`, mặc định tắt — ADR-0031), khung giờ gửi `PUT …/send-window` (`app.manage`, giờ Việt Nam, tin bắt buộc mặc định bỏ qua — ADR-0032), dàn đều `PUT …/pacing` (`app.manage`, ≤ trần) + trần tốc độ `PUT …/pacing-ceiling` (chỉ Super Admin), xác thực `/v1/*` |
| `audit` | consumer `audit-writer` (`audit.events` -> `audit_log`), `GET /admin/audit` |
| `webhooks` | outgoing webhook (ADR-0029): `/admin/apps/:appId/webhooks` (≤ N URL mỗi app, N = cài đặt `webhooks.max_endpoints_per_app`, mặc định 10 — `slot` + unique; secret không lưu, tính từ `WEBHOOK_SIGNING_KEY`; gửi thử; nhật ký gọi); consumer `webhook-dispatcher` (`webhook.events` -> ghi `webhook_deliveries`); job `deliver-webhooks` gọi HTTPS ngoài transaction, chặn IP nội bộ lúc phân giải DNS, gọi lại 6 lần trong ~8,5 giờ |
| `incoming` | incoming webhook (ADR-0030): `POST /hooks/:token` (public, token = khoá; token tính lại từ `WEBHOOK_SIGNING_KEY` + id + `token_version`, lấy lại qua `GET …/:hookId/url` có audit) -> ánh xạ đường dẫn JSON thành `payload` -> điều kiện -> giới hạn mỗi phút -> chống trùng -> `PublishToTopic`; quản lý dưới `/admin/apps/:appId/incoming-webhooks` (≤ N hook, N = cài đặt `incoming.max_hooks_per_app`, mặc định 20 — `slot` + unique; xem trước bằng JSON mẫu; nhật ký gọi 30 ngày) |
| `settings` | Cài đặt hệ thống do Super Admin chỉnh (ADR-0030): `GET/PUT /admin/system-settings` (`platform.manage`); danh mục cố định trong `domain/rules/system-settings.ts`; `SystemSettingsQueries.current()` đệm 30 giây cho module khác |
| `templates` | admin tạo / đổi tên + nhóm (`PATCH`, `UpdateTemplate`) / lưu nháp / tạo nháp từ bản cũ / xuất bản / lưu trữ dưới `/admin/apps/:appId/templates` (ADR-0020); nhóm cố định `templates.category` (7 giá trị, mặc định `other`), danh sách lọc `?category=&q=` (tìm tên theo collation), `POST …/:id/duplicate` nhân bản trong app thành template mới chỉ có nháp v1 (ADR-0033); tối đa 1 nháp + 1 published mỗi template, khoá dòng `templates` trước mọi lệnh ghi; kiểm tra nội dung chạy lúc xuất bản; `POST …/ai-compose` trả đề xuất của AI (không ghi DB, dùng biến đã khai, thiếu thì đề xuất `suggestedVariables` để người soạn duyệt, 10 lần/phút/admin — ADR-0020 §7); `RenderTemplate` (đổ `payload` vào bản đang xuất bản) + `TemplateQueries.labelsOf` cho module khác; version có `editor` + `design` JSON; bộ soạn trực quan (ADR-0036, luôn bật — ADR-0037): kiểu `visual` — trình duyệt (GrapesJS + MJML) sinh `html`, lưu nháp chạy `checkEmailHtml()` (domain, danh sách cho phép, đọc cả nhánh `[if mso]`, TỪ CHỐI 422 chứ không sửa) + `normalizeLiquid()` + `emailHtmlToText()` sinh `text`; `design` = `{ format: 'grapesjs-mjml', version, project, mjml }`; kiểu kéo-thả `blocks` (ADR-0034) ĐÃ NGỪNG (ADR-0037): tạo / lưu nháp / nhân bản / tạo nháp từ bản `blocks` -> 422 `EDITOR_NOT_SUPPORTED`, dòng cũ chỉ đọc, `admin-cli purge-blocks-templates` dọn (mặc định chạy thử, `--apply` xoá, từ chối template còn thư / lần phát / incoming hook hoặc lẫn kiểu); `design-preview` / `convert-to-html` còn tới deploy 2; thư viện mẫu (ADR-0035): `GET /admin/template-presets` trả `mjml` (`designToMjml`, mẫu vẫn viết bằng `EmailDesign`) + `html` ảnh thu nhỏ (`renderDesign`), `POST …/templates/from-preset` nhận `html` + `design` do CONSOLE biên dịch từ MJML (backend không có trình biên dịch MJML) -> template `visual`; `admin-cli scan-template-html` chạy thử bộ kiểm trên kiểu `html` (chỉ đọc) |

`segments` mới có domain + schema (ngoài phạm vi MVP). `/admin/*` dùng **phiên đăng nhập admin**
(`/auth/login` hoặc Microsoft 365 qua `/auth/m365/*` — ADR-0021; lần đầu M365 tự tạo tài khoản — ADR-0024 -> token mờ lưu băm trong `admin_sessions`)
và **RBAC đa tenant** (ADR-0022 — người ngoài org nhận 404); admin đầu tiên tạo bằng `admin-cli` chạy trong
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
| `0020` | **Template**: app gửi bằng `templateId` (bỏ `key`), tên không trùng trong app, không binding topic, đổ biến lúc API nhận request (qua `RenderTemplate`, worker không đổi), nháp lỏng / xuất bản chặt, lỗi template đều 422; AI soạn gọi ở backend, chuẩn tương thích OpenAI, 3 biến `AI_*`; AI chỉ ĐỀ XUẤT biến mới, người soạn duyệt mới thêm |
| `0021` | **Đăng nhập console bằng Microsoft 365**: OIDC + PKCE, backend giữ secret, App registration riêng (không dùng lại `GRAPH_*`), callback ở domain console, chỉ admin đã có (khớp email rồi gắn `microsoft_oid`); mật khẩu giữ làm dự phòng |
| `0022` | **RBAC đa tenant**: Super Admin (vai hệ thống duy nhất) · Owner > Org Admin > Member · App Admin / App Viewer; người ngoài org 404, thiếu vai 403; luật thuần `decide()` ở kernel; MỌI route `/admin` khai `{ config: access(...) }` — thiếu là server không khởi động; bổ sung: bỏ quyền `topic.mandatory`, đặt / bỏ topic bắt buộc thuộc `app.manage` |
| `0023` | **App tự phục vụ, bỏ duyệt**: tạo app là `active` + kênh `email` ngay (`App.register`); đội app tự cấp khoá; Super Admin chỉ tạm ngưng / thu hồi app rác. App cũ `draft` / `pending_approval` để nguyên, vẫn duyệt được — test dựng chúng thẳng trong DB; bổ sung: giới hạn IP chỉ Super Admin khai (`platform.manage`), bỏ luật Origin; trần khoá API active thành cài đặt hệ thống (mặc định 20), khoá có tên + `last_used_at` |
| `0024` | **Tự tạo tài khoản ở lần đăng nhập M365 đầu tiên**: vai `user`, chưa thuộc org, không mật khẩu, vào account cũ nhất (`findOldest`); chỉ người trong tenant M365 qua được; race lần đầu -> `insertIfAbsent` rồi đọc lại theo `oid`. Thay bước 3 của ADR-0021 |
| `0025` | **Org tự phục vụ**: quyền `org.create` (ai đăng nhập cũng có), `POST /admin/organizations` tạo org trong account của chính mình + ghi mình là Owner trong CÙNG transaction. Chưa làm hạn mức / đổi tên / xoá / chuyển Owner |
| `0026` | **Màn Thành viên**: quyền `org.manage` (Owner, Org Admin); thêm / đổi vai / gỡ thành viên, cấp / thu hồi vai app qua `/admin`; CHỈ Owner động được vai Owner (`OWNER_REQUIRED`); email chưa có tài khoản -> 422 `ADMIN_NOT_REGISTERED`; gỡ khỏi org thu hồi vai app CÙNG transaction (`apps/RemoveMemberFromOrg` gọi tenancy qua port) |
| `0027` | **Đồng bộ danh bạ M365**: Super Admin bấm `POST /admin/directory/m365-sync` -> đọc `/users` bằng app `GRAPH_*` (`User.Read.All`), tạo / gắn tài khoản cùng luật ADR-0024; hai tenant `GRAPH_*` / `M365_*` phải trùng; cột `admins.display_name`; hộp Thêm thành viên chọn từ `GET …/member-candidates`; bổ sung: cột `admins.member_listed`, Super Admin tích ở màn Danh bạ, nút đồng bộ chuyển sang đó |
| `0028` | **Phát tin vào topic**: `POST /v1/publications` -> một dòng `publications` + mỗi người theo dõi một notification con (`publication_id`), worker không đổi; người nhận chốt lúc phát bằng `emailGate` (không dùng pipeline segments); trần 100 người (422 `PUBLICATION_TOO_LARGE`), mọi thứ trong MỘT transaction; `idempotencyKey` bắt buộc; topic bắt buộc phát được |
| `0029` | **Outgoing webhook**: module `webhooks`; 3 sự kiện kết quả thư (+ `ping`), body không có email / nội dung; consumer chỉ ghi lượt, job gọi ra ngoài; gọi ít nhất một lần, chữ ký HMAC `t=…,v1=…`; secret = HMAC(`WEBHOOK_SIGNING_KEY`, id:version) — thiếu khoá thì 503 `WEBHOOK_NOT_CONFIGURED`; chặn IP nội bộ; tối đa N URL bằng unique `(app_id, slot)` — bổ sung: N là cài đặt hệ thống (mặc định 10) |
| `0030` | **Incoming webhook + Cài đặt hệ thống**: module `incoming` (`POST /hooks/:token`, token băm SHA-256; ánh xạ đường dẫn JSON `a.b` / `a[0]` / `a[-1]` / `a["k.k"]` > chữ cố định > trường cùng tên; chuỗi rỗng = không có; điều kiện phát; chống trùng header > đường dẫn > băm body + khung; giới hạn mỗi phút trên Redis; phát bằng `PublishToTopic`); module `settings` (`system_settings`, danh mục + khoảng cho phép, chỉ Super Admin, đệm 30 giây). Bổ sung: token tính lại được (HMAC `WEBHOOK_SIGNING_KEY`), `GET …/url` lấy lại URL bất cứ lúc nào + audit `IncomingHookUrlRevealed`; console chỉ hỏi topic + template |
| `0031` | **Đếm "đã mở" bằng ảnh theo dõi**: KHÔNG dùng `Mail.ReadBasic.All` / `isRead` (đọc được tiêu đề mọi thư cả công ty); ảnh 1×1 chèn lúc gửi khi app bật + có `api.public_base_url` + `WEBHOOK_SIGNING_KEY`; URL ký HMAC (`email-open:<id>`); route public luôn trả cùng ảnh; con số là ước lượng (Outlook chặn ảnh, Apple Mail tải sẵn) |
| `0032` | **Giới hạn gửi theo app**: Super Admin giữ trần chung, Admin App chỉnh trong trần. GĐ 1: khung giờ gửi (`apps.send_window`, giờ VN cố định UTC+7) — giữ lúc NHẬN bằng trạng thái `scheduled` có sẵn, job `promote-scheduled` thả khi tới giờ; ngoại lệ tin bắt buộc là công tắc theo app (mặc định bật). GĐ 2: dàn đều — Admin App đặt N thư / phút trong trần của Super Admin; trần áp cả tin bắt buộc; lượt giữ LÚC NHẬN trên Redis (`MinuteSlotAllocator`), không chờ ở worker. GĐ 3 giới hạn mỗi người / trần app mỗi giờ — chưa làm |
| `0033` | **Template: nhóm, tìm, nhân bản**: nhóm cố định `templates.category` (`TEMPLATE_CATEGORIES`, chỉ để gom / lọc, không ảnh hưởng gửi); đổi nhóm đi chung `PATCH` với đổi tên, mỗi thứ đổi một event; tìm tên bằng `LIKE` theo collation; nhân bản = template mới, nháp v1 chép từ nháp (không có thì bản xuất bản), tên bắt buộc (console ghép hậu tố theo ngôn ngữ), trùng -> 409; bản gốc lưu trữ vẫn nhân bản được. Thư viện mẫu: ADR-0035 |
| `0034` | **Trình soạn kéo-thả** (ĐÃ NGỪNG — ADR-0037): `template_versions.editor` + `design` (migration 0025); backend sinh HTML dạng bảng ≤ 600px + chữ thường từ thiết kế, ghi vào `html` / `text` — `validate()`, `RenderTemplate`, worker, `/v1` không đổi; escape mọi chữ trừ khối `html`; `src` ảnh chỉ `https://` kiểm lúc lưu (`IMAGE_URL_NOT_ALLOWED`), link khác kiểm lúc xuất bản; giới hạn ở `checkDesign`; nháp khác kiểu -> 409 `EDITOR_MISMATCH`; chỉ chuyển blocks -> html; AI chỉ ở kiểu HTML |
| `0035` | **Thư viện mẫu dựng sẵn**: 12 mẫu viết trong code (`templates/domain/presets/`, vi / en, viết bằng `EmailDesign` — từ ADR-0037 tạo ra kiểu `visual`, không ảnh), không migration; `GET /admin/template-presets` (quyền `catalog.read` — ai đăng nhập cũng có) trả kèm `html` đã sinh; `POST …/templates/from-preset` đi đúng `CreateTemplate`, tên bắt buộc; chép một lần, không đồng bộ khi mẫu đổi; "tạo từ mẫu" chỉ ghi audit `after.createdFromPreset`; test chạy mọi mẫu × mọi ngôn ngữ qua `validate()` |
| `0036` | **Bộ soạn trực quan GrapesJS + MJML**: kiểu `visual` (migration 0026, dùng lại cột `design`); trình duyệt sinh HTML, backend `checkEmailHtml` (danh sách cho phép, không `on*`, CSS không chạy được, link không scheme nguy hiểm, ảnh chỉ `https://`, giữ nhánh `[if mso]`) rồi TỪ CHỐI 422 — chỉ `normalizeLiquid` được sửa (`&quot;` trong `{{ }}` -> `'`); backend sinh `text`; không thêm gói đọc HTML (domain cấm package ngoài); ~~cờ `templates.visual_editor_enabled`~~ (bỏ ở ADR-0037); kiểu `html` CHƯA bật kiểm — `admin-cli scan-template-html` chạy thử; thay ADR-0034 §2.2 riêng cho `visual`. Bổ sung UX-3: `{{ … }}` trong thuộc tính là khối kín (nháy kép bên trong không kết thúc thuộc tính) nhưng phải đúng dạng biến, sai -> `HTML_MALFORMED` |
| `0037` | **Ngừng kéo-thả, trực quan luôn bật, mẫu ra `visual`** (UX-4): ghi kiểu `blocks` -> 422 `EDITOR_NOT_SUPPORTED`, dòng cũ chỉ đọc; bỏ cờ + kiểu cài đặt `bool` + `GET /admin/template-editor-options`; `designToMjml` (domain); mẫu biên dịch ở TRÌNH DUYỆT (GrapesJS headless) rồi `from-preset` nhận `html` + `design`, backend kiểm như lưu nháp — test kiểm HTML thật của mjml-browser (`fixtures/preset-html.json`, khớp `sha256` MJML); `admin-cli purge-blocks-templates` (chạy thử / `--apply`, mỗi template một transaction, audit `TemplatePurged`); deploy 2: migration 0027 kiểm còn `blocks` thì FAIL rồi ENUM (`html`, `visual`) |

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
    rate-limit/            FixedWindowRateLimiter (Redis, cửa sổ 1 phút, dùng chung mọi process) · MinuteSlotAllocator (giữ trước lượt gửi theo phút — dàn đều) — chỉ infrastructure import
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

13 module: `tenancy` · `apps` · `directory` · `subscriptions` · `topics` · `segments` ·
`templates` · `notifications` · `delivery` · `webhooks` · `incoming` · `settings` · `audit`.

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
  `published_marker` + unique index. "≤ N secret active" **không** mô phỏng được — phải ép trong command,
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
- **Năm composite FK chống cấp quyền chéo account** (ADR-0011, ADR-0022): `fk_apps_org_account`,
  `fk_admin_app_roles_admin_account`, `fk_admin_app_roles_app_account`, `fk_org_members_org_account`,
  `fk_org_members_admin_account`. Đích bắt buộc: `uq_organizations_org_account`, `uq_admins_admin_account`,
  `uq_apps_app_account`. Cùng lý do — đừng xoá.

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
- **Mọi route `/admin` khai quyền** (ADR-0022): `app.get(path, { config: access('app.read') }, …)`.
  Thiếu là `buildHttpServer` ném lỗi lúc khởi động. Đối tượng mặc định lấy từ `:appId` rồi `:orgId`;
  org nằm ở query / body thì khai `target` (xem `GET /apps`, `POST /apps`). Route danh sách lọc theo
  `adminAccess(request)` + `decide()`. Thêm quyền mới = sửa `shared/kernel/access-policy.ts` + test.
- **Bề mặt ĐỌC cho vận hành đặt dưới `/admin/apps/:appId/*`** (plan §5, ĐX-0004). `appId` trên URL
  chứ không suy từ token — lớp kiểm quyền (ADR-0022) tra app -> org từ chính tham số đó. Nhóm này
  **chỉ đọc** — admin không sửa consent hộ người dùng; app service tự ghi qua `/v1` bằng khoá của nó.
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
