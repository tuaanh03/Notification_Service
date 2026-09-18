# ADR-0002 (sửa đổi) — MySQL 8 thay vì PostgreSQL 16

**Trạng thái:** chấp nhận — 2026-09-17. **Thay thế** ADR-0002 trong `EWS-Backend-Architecture.docx`,
vốn chọn PostgreSQL *thay vì* MySQL.

## Quyết định
Dùng MySQL 8 (InnoDB, utf8mb4) làm nguồn sự thật.

## Hệ quả phải thiết kế khác đi

| Tài liệu gốc dựa vào | MySQL không có | Cách thay thế đã dùng |
| --- | --- | --- |
| `gen_random_uuid()` | — | ID sinh ở application (`shared/kernel/ids.ts`), lưu `CHAR(36)` |
| `TIMESTAMPTZ` | TIMESTAMP chết năm 2038, tự đổi theo timezone session | `DATETIME(3)`, application luôn ghi UTC |
| `jsonb` + GIN index | JSON không có GIN | `JSON`; muốn lọc nhanh thì thêm generated column + index cho đúng field |
| `text[]` | không có kiểu mảng | `JSON` array (`granted_channels`, `default_channels`) |
| partial unique index | không có | generated column trả NULL khi không khớp + unique index (xem `template_versions.published_marker`) |
| partial index thường | không có | index đầy đủ, query phải kèm điều kiện (`idx_notifications_scheduled`) |
| DDL trong transaction | DDL tự commit | migration hỏng giữa chừng để lại trạng thái dở — mỗi migration phải chạy lại được |
| tên định danh 63 byte, tự cắt khi dài quá | **báo lỗi** `ER_TOO_LONG_IDENT` khi tên > 64 ký tự | FK có tên tự sinh dài quá thì khai tên tay `fk_...` (sửa 2026-09-18: 4 FK của `0000` từng vượt giới hạn, migration không chạy được trên MySQL thật cho tới khi có test tích hợp) |

## Hai thứ MySQL vẫn làm được, kiến trúc không phải đổi
- `SELECT ... FOR UPDATE SKIP LOCKED` (MySQL 8.0+) — outbox relay và scheduler giữ nguyên thiết kế.
- `CHECK` constraint (MySQL 8.0.16+).

## Một may mắn đúng chiều
Unique index của MySQL coi mỗi `NULL` là một giá trị khác nhau. Nhờ vậy
`UNIQUE (app_id, idempotency_key)` hành xử đúng như partial index
`WHERE idempotency_key IS NOT NULL` của Postgres — không cần mẹo gì thêm.

## Rủi ro còn lại
InnoDB **cho phép** foreign key trỏ tới index không unique. Nghĩa là hai composite FK
chống rò rỉ chéo org sẽ âm thầm yếu đi nếu ai đó xoá `uq_apps_app_org` / `uq_persons_person_org`
vì tưởng chúng thừa. Hai index đó là bắt buộc — có comment tại chỗ trong schema.
