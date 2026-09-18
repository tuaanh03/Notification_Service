# ADR-0017 — Mức cô lập transaction: READ COMMITTED

**Trạng thái:** chấp nhận — 2026-09-19. Đặt cho MỌI connection trong `shared/db/client.ts`.

## Bối cảnh
MySQL mặc định REPEATABLE READ (RR): lệnh `SELECT` thường (consistent read) ĐẦU TIÊN của transaction
chốt snapshot, mọi `SELECT` thường sau đó đọc snapshot ấy — kể cả khi transaction vừa phải chờ một
khoá mà bên kia giữ tới lúc commit.

Mẫu "khoá dòng cha rồi mới đọc" (ADR-0009) vì thế chỉ đúng khi lệnh khoá là lệnh ĐẦU TIÊN.
`IssueAppSecret` (lượt 4) đúng tình cờ vì thế. `UpsertUser` (MVP GĐ 1) tra user theo external_id
TRƯỚC khi khoá dòng user -> snapshot chốt trước lúc chờ khoá -> sau khi có khoá vẫn không thấy
subscription bên kia vừa tạo -> tạo thêm. Test `race()` 5 request đặt email cho cùng một user ra 5
subscription; quay lại RR là lỗi tái hiện ngay.

## Quyết định
`SET SESSION transaction_isolation = 'READ-COMMITTED'` cho mọi connection của pool.

Ở READ COMMITTED mỗi lệnh đọc thấy dữ liệu đã commit mới nhất -> khoá xong là đọc đúng, bất kể thứ tự
câu lệnh. Không còn gap lock khi tìm kiếm -> bớt loại deadlock "hai bên cùng khoá khoảng trống rồi cùng
INSERT" (thay vào đó unique index quyết định, adapter đổi thành lỗi nghiệp vụ 409).

## Hệ quả
- Không còn "đọc lại cùng một dòng trong transaction ra cùng kết quả". Command không được dựa vào điều
  đó; muốn giá trị không đổi giữa hai lần đọc thì khoá (`FOR UPDATE` / `lockParentRow`).
- Không đổi: conditional update (`WHERE status = :expected`) — UPDATE luôn đọc bản mới nhất ở cả hai
  mức; `FOR UPDATE SKIP LOCKED` của outbox relay; unique index là chốt cuối chống trùng.
- MySQL 8 mặc định `binlog_format = ROW`, điều kiện để chạy READ COMMITTED với binlog.
- Có test: `migrations.test.ts` kiểm session là READ-COMMITTED; `users-api.test.ts` có race chứng minh.
