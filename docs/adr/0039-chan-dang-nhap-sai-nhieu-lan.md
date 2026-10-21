# ADR-0039 — Chặn đăng nhập mật khẩu sai nhiều lần

**Trạng thái:** chấp nhận — 2026-10-21. Task: `docs/ews-tasks-rbac.csv` — RBAC GĐ 1.7.

## Bối cảnh

`POST /auth/login` (mật khẩu, ADR-0019) không giới hạn số lần sai: ai tới được console là thử mật khẩu Super Admin
được mãi. Đăng nhập đi trình duyệt -> server console (Next.js) -> API, nên `request.ip` ở API luôn là IP của
container console — đếm theo nó là gộp cả công ty vào một bộ đếm.

## Quyết định

1. **Con số do Super Admin chỉnh**, lưu trong cài đặt hệ thống (ADR-0030) nhóm `auth.*` — không thêm bảng. Console
   hiện ở mục riêng **"Theo dõi & Bảo mật"** (`/admin/security`), trang Cài đặt hệ thống không hiện nhóm này.

   | Khoá | Mặc định | Khoảng |
   | --- | --- | --- |
   | `auth.lockout_enabled` | `true` | bật / tắt |
   | `auth.max_failed_attempts` | 5 | 3–20 |
   | `auth.failure_window_minutes` | 15 | 1–1440 |
   | `auth.lockout_minutes` | 15 | 1–1440 |
   | `auth.ip_max_failed_attempts` | 30 | 10–1000 |
   | `auth.permanent_lock_after` | 0 (không bao giờ) | 0–10 |

2. **Khoá tạm ở Redis** (`RedisLoginAttemptStore`, một script Lua — nhiều bản `api` cùng ghi không lọt ngưỡng):
   sai `max` lần cho một email trong khung (tính từ lần sai đầu) -> khoá email `lockout_minutes`; sai `ipMax` lần từ
   một IP (mọi email cộng lại) -> khoá IP. Khoá tự hết hạn. Key `login:fail:*`, `login:lock:*`, `login:streak:e:*`.
   Email tính theo chữ thường, kể cả email không có tài khoản (người dò thử email bịa cũng bị khoá).
3. **Khoá hẳn ở MySQL** (`admins.locked_at`, migration 0028): khoá tạm `permanent_lock_after` lần liên tiếp (chuỗi
   giữ 24 giờ, đăng nhập đúng là xoá) -> ghi `locked_at`, xoá mọi phiên, audit `AdminLocked`. Khoá hẳn chặn cả
   mật khẩu lẫn Microsoft 365 (`ADMIN_LOCKED` 403 — người đó vừa chứng minh danh tính với Microsoft nên nói rõ được),
   phiên đang mở hết hiệu lực. Mặc định TẮT: ai biết email cũng cố tình nhập sai để khoá được người khác.
4. **Không lộ gì cho người dò.** Đang khoá tạm, khoá hẳn, sai mật khẩu, email lạ — đều `401 INVALID_CREDENTIALS`.
   Đang khoá thì không băm mật khẩu (đoán đúng cũng không vào). Màn đăng nhập chỉ có một câu chung.
5. **IP thật**: console gửi `x-ews-client-ip` + `x-ews-client-ip-key`; API chỉ tin khi khoá bằng
   `LOGIN_CLIENT_IP_SECRET` (so thời gian hằng). Chưa cấu hình / sai khoá / IP sai định dạng -> coi như không biết IP,
   chỉ đếm theo email — KHÔNG BAO GIỜ rơi về `request.ip`. Tầng proxy trước console phải ghi đè `X-Forwarded-For`.
6. **Bộ đếm hỏng thì cho qua.** Redis lỗi -> ghi log `error`, đăng nhập chạy như chưa có tính năng này: phiên ở
   MySQL, khoá cả hệ thống vì mất bộ đếm là tự gây sự cố lớn hơn thứ đang chống. Khác ADR-0032 (dàn đều cần Redis).
7. **Đăng nhập Microsoft 365 không bị khoá tạm** — Microsoft đã có MFA và luật riêng; chỉ khoá hẳn chặn nó.
8. **Audit**: `LoginLocked` (khoá tạm tài khoản có thật), `AdminLocked` (khoá hẳn), `LoginUnlocked` (ai mở, mở gì);
   đổi con số đi chung `SystemSettingsUpdated`. Khoá IP / email không có tài khoản chỉ ghi log (aggregate audit là
   uuid của tài khoản).
9. **Mở khoá**: `GET /admin/login-locks` (khoá tạm + khoá hẳn), `POST /admin/login-locks/unlock` `{ email } | { ip }`
   — `platform.manage`; không còn gì để mở -> 404. Dự phòng khi chính Super Admin bị khoá:
   `admin-cli unlock-login --email <email>`.

## Hệ quả

- Công ty ra internet chung một IP: 30 lần sai cộng lại trong 15 phút là khoá cả văn phòng ở đường mật khẩu (M365
  vẫn vào). Super Admin nâng `auth.ip_max_failed_attempts` hoặc mở IP ở màn "Theo dõi & Bảo mật".
- Đổi con số không áp lại cho khoá đang giữ; cài đặt đệm 30 giây ở các bản `api` khác.
- Mất Redis = mất mọi khoá tạm (khoá hẳn còn nguyên).
