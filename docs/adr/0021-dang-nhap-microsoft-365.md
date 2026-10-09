# ADR-0021 — Đăng nhập console bằng Microsoft 365

**Trạng thái:** chấp nhận — 2026-10-06. Bổ sung ADR-0019 (phiên đăng nhập giữ nguyên).
**Sửa đổi:** 2026-10-09 — ADR-0024 thay luật "chỉ admin đã có": lần đăng nhập đầu không khớp email nay tự tạo tài khoản.

## 1. Bối cảnh

Người dùng console là nhân viên công ty, đã có tài khoản Microsoft 365. Mật khẩu riêng cho EWS là
thêm một thứ để quên, để lộ và để `admin-cli reset-password`. Đăng nhập M365 cho họ dùng đúng tài
khoản công ty (kèm MFA của tenant), và nghỉ việc là bị khoá theo.

## 2. Quyết định

**OpenID Connect với Entra ID, Authorization Code + PKCE, client là BACKEND.**

```
Trình duyệt → console /login (bấm nút) → POST /auth/m365/start → link Microsoft + state
           → login.microsoftonline.com (đăng nhập, MFA)
           → console /auth/callback/microsoft?code&state   (M365_REDIRECT_URI)
                console kiểm state khớp cookie → POST /auth/m365/callback {code, state}
                backend đổi code (secret + code_verifier) → kiểm id_token → tạo phiên như ADR-0019
           → console đặt cookie phiên
```

- **App registration RIÊNG**, không dùng lại app `GRAPH_*`: app gửi thư giữ quyền APPLICATION
  `Mail.Send` (gửi thay bất kỳ ai). App đăng nhập chỉ có delegated `openid profile email`. Lộ secret
  đăng nhập không kéo theo quyền gửi thư; hai secret hết hạn / xoay vòng độc lập.
- **Single tenant.** Token phải có `tid` = `M365_TENANT_ID`, `iss` = issuer của đúng tenant đó.
- **Callback đặt ở domain CONSOLE**, không ở subdomain API: cookie phiên thuộc domain console. Đặt ở
  API thì phải đặt cookie cho cả `.eonsr.net` (mọi subdomain đọc được) hoặc đưa token qua URL (vào
  lịch sử, vào log). Trang callback chỉ nhận `code` dùng một lần; secret vẫn chỉ ở backend.
- **`state`, `nonce`, `code_verifier` giữ ở backend** (Redis, 10 phút, `GETDEL` — dùng một lần, mọi
  bản `api` đều thấy). Console chỉ cầm `state` trong cookie `httpOnly`, `path` = trang callback, để
  buộc lượt đăng nhập vào đúng trình duyệt đã bấm nút (chặn login CSRF).
- **Kiểm `id_token` đủ bước** dù token đi thẳng từ Microsoft qua TLS: chữ ký RS256 theo khoá công
  khai của tenant (giữ 24 giờ, `kid` lạ thì tải lại), `iss`, `aud`, `tid`, `exp` / `nbf` (lệch 5 phút),
  `nonce`. Dùng `node:crypto`, không thêm thư viện JWT.

## 3. Khớp tài khoản — chỉ người ĐÃ CÓ tài khoản EWS

Chưa có RBAC thì ai đăng nhập được là thấy mọi app; tự tạo tài khoản ở lần đăng nhập đầu là mở
console cho cả công ty. Vì vậy:

1. Tra `admins.microsoft_oid` (đã gắn từ lần trước). `oid` không đổi; email thì có thể đổi.
2. Chưa gắn: khớp email đã chuẩn hoá (claim `email`, thiếu thì `preferred_username`) → gắn `oid`
   vào admin đó, audit `AdminMicrosoftLinked`. Gắn có điều kiện `microsoft_oid IS NULL` — hai lần
   đăng nhập đầu chạy song song không đè nhau.
3. Admin đã gắn `oid` KHÁC → 403 `M365_ACCOUNT_MISMATCH`, không đè.
4. Không khớp → 403 `M365_ACCOUNT_NOT_REGISTERED`. Người này đã được Microsoft xác thực nên nói rõ
   lý do không lộ thêm gì (khác `INVALID_CREDENTIALS` của đăng nhập mật khẩu).

Tạo người chỉ dùng M365: `admin-cli create-admin --email … --login m365` (không mật khẩu).
Tự tạo tài khoản lúc đăng nhập đầu chờ RBAC.

**Giữ đăng nhập mật khẩu** làm đường dự phòng khi Microsoft / cấu hình hỏng.

## 4. Cấu hình và mã lỗi

Bốn biến `M365_TENANT_ID` (GUID), `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `M365_REDIRECT_URI` —
đủ cả bốn hoặc trống cả bốn (thiếu một là dừng khởi động). Trống = tắt: `GET /auth/m365` trả
`{ enabled: false }`, console ẩn nút.

| Mã | HTTP | Nghĩa |
| --- | --- | --- |
| `M365_NOT_CONFIGURED` | 503 | Chưa cấu hình `M365_*` |
| `M365_STATE_INVALID` | 401 | `state` lạ / hết hạn / đã dùng |
| `M365_SIGN_IN_FAILED` | 401 | Microsoft từ chối `code` (`invalid_grant`) — bấm lại là xong |
| `M365_TOKEN_INVALID` | 401 | `id_token` không qua bước kiểm nào đó |
| `M365_PROVIDER_ERROR` | 502 | Không gọi được Microsoft, hoặc lỗi cấu hình (`invalid_client` = secret sai / hết hạn) |
| `M365_ACCOUNT_NOT_REGISTERED` | 403 | Không có admin nào khớp |
| `M365_ACCOUNT_MISMATCH` | 403 | Admin đã gắn tài khoản Microsoft khác |

Không log, không đưa vào message lỗi: `code`, `client_secret`, token.
