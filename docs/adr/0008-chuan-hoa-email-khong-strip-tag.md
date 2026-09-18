# ADR-0008 — Chuẩn hoá email: chỉ trim + lowercase

**Trạng thái:** chấp nhận — 2026-09-17.

## Quyết định
`normalizeEmail()` (`src/shared/kernel/email.ts`) chỉ `trim()` + `toLowerCase()`.
**Không** strip `+tag`, **không** bỏ dấu chấm kiểu Gmail.

## Lý do
Đây là khoá merge của Identity Resolver (`persons.primary_email`, `UNIQUE (org_id, primary_email)`).
Strip sai sẽ gộp nhầm hai người cố ý tách hộp thư bằng `+shop` / `+seller`. Gộp nhầm person
nghĩa là thư riêng của người này lọt sang người kia — nặng hơn nhiều so với việc để dư một person.

## Hệ quả
Cùng một người dùng hai email khác nhau sẽ thành 2 person và nhận 2 lần. Đây là đánh đổi
được chấp nhận, không phải lỗi của resolver.

**Đổi hàm này = phải chạy lại toàn bộ person đã gộp.** Sửa ở đúng một chỗ, không sửa ở nơi gọi.
