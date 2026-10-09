# ADR-0024 — Tự tạo tài khoản ở lần đăng nhập Microsoft 365 đầu tiên

**Trạng thái:** chấp nhận — 2026-10-09. Thay bước 3 của ADR-0021 ("không khớp email -> 403
`M365_ACCOUNT_NOT_REGISTERED`"). Task: `docs/ews-tasks-rbac.csv` — "RBAC GĐ 2" (phần tự tạo tài khoản).

## Bối cảnh

ADR-0021 chỉ cho admin ĐÃ CÓ vào bằng M365, vì lúc đó chưa có RBAC: tạo tài khoản là mở toàn bộ
console. Nay đã có RBAC (ADR-0022) và app tự phục vụ (ADR-0023): người mới vào mà chưa thuộc org
nào thì không thấy gì. Bắt Super Admin chạy `admin-cli create-admin` cho từng người là chỗ nghẽn
duy nhất còn lại của luồng tự phục vụ.

## Quyết định

1. Đăng nhập M365 mà không khớp `oid` lẫn email -> **tự tạo** admin: vai `user`, `password_hash`
   NULL (chỉ đăng nhập được bằng M365), gắn sẵn `microsoft_oid`, chưa thuộc org nào.
2. **Ai được tự tạo:** mọi người qua được bước kiểm `id_token` — tức đúng tenant M365 của công ty
   (`tid`, ADR-0021). Người ngoài tenant không tới được bước này. Không có danh sách cho phép riêng.
3. **Account:** account tạo ĐẦU TIÊN (`AccountRepository.findOldest`) — account của bản cài. Không
   thêm biến môi trường. Chưa có account nào -> 403 `M365_ACCOUNT_NOT_REGISTERED`.
4. Token không có email hợp lệ -> 403 `M365_ACCOUNT_NOT_REGISTERED` (không có gì để định danh).
5. **Đồng thời:** hai lần đăng nhập đầu của cùng một người chạy song song -> lần thua dính trùng
   khoá (`uq_admins_microsoft_oid` / `uq_admins_account_email`, `AdminRepository.insertIfAbsent`)
   rồi đọc lại theo `oid`. Có test `race()` qua HTTP + MySQL thật.
6. Audit: event `AdminCreated` với `actor` là chính người đó, `after.via = 'microsoft_first_sign_in'`.

## Hệ quả

- Người mới: đăng nhập M365 -> tạo org (task 1.3) / được Owner thêm vào (task 1.5) -> tạo app.
- `admin-cli create-admin` vẫn dùng để tạo Super Admin, hoặc người cần mật khẩu.
- Bản cài có nhiều account: tài khoản tự tạo luôn vào account cũ nhất; admin ở account khác không
  thể là thành viên org của account đó (composite FK, ADR-0011 / ADR-0022).
