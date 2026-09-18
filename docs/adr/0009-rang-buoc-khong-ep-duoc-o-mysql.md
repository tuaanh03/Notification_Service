# ADR-0009 — Ràng buộc không ép được ở MySQL, phải ép ở command

**Trạng thái:** chấp nhận — 2026-09-17.

Một số ràng buộc của thiết kế gốc dựa vào partial index của PostgreSQL. MySQL không có,
và không phải cái nào cũng mô phỏng được bằng generated column.

| Ràng buộc | Cách ép | Ghi chú |
| --- | --- | --- |
| Mỗi template tối đa 1 version `published` | **Ép được ở DB**: generated column `published_marker` (1 khi published, NULL khi không) + `UNIQUE (template_id, published_marker)` | NULL trong unique index của MySQL là khác nhau nên nhiều draft vẫn cùng tồn tại |
| Mỗi app tối đa **2** secret `active` | **Không ép được ở DB** | `AppSecret.assertCanAddActive(count)` phải được gọi trong CÙNG transaction với lần INSERT, sau khi khoá **dòng cha** `apps` — xem mục bên dưới |
| `notifications` unique idempotency khi key khác NULL | **Ép được ở DB** | MySQL coi mỗi NULL là khác nhau -> `UNIQUE (app_id, idempotency_key)` hành xử đúng như partial index |
| Partition `notification_recipients` theo tháng | **Hoãn** | MySQL bắt mọi khoá unique phải chứa cột partition -> sẽ buộc nhét `created_month` vào PK. Quyết định để lại cho ADR retention |

## Khoá dòng cha, không khoá tập dòng đang đếm

**Sửa 2026-09-18.** Bản trước chỉ ghi "sau khi `SELECT ... FOR UPDATE`", dễ bị hiểu thành khoá trên
chính tập đang đếm:

```sql
-- SAI: khi app đang có 0 hoặc 1 secret active
SELECT COUNT(*) FROM app_secrets WHERE app_id = ? AND status = 'active' FOR UPDATE;
```

Ở REPEATABLE READ, khi tập đó ít hoặc không có dòng, InnoDB chỉ lấy **gap lock**. Gap lock không
loại trừ nhau: hai transaction cùng đếm ra 1, cùng INSERT, và app có 3 secret active — hoặc hai bên
chờ insert-intention lock của nhau và deadlock.

Cách đúng là tuần tự hoá trên **đúng một dòng có thật**, là dòng cha:

```sql
SELECT app_id FROM apps WHERE app_id = ? FOR UPDATE;           -- record lock trên PK
SELECT COUNT(*) FROM app_secrets WHERE app_id = ? AND status = 'active';
-- assertCanAddActive(count) rồi INSERT, cùng transaction
```

Mọi command thay đổi secret của một app (tạo, xoay, thu hồi) đều phải khoá dòng `apps` trước.

**Bổ sung 2026-09-19 (ADR-0017):** mẫu này cần mức cô lập READ COMMITTED. Ở REPEATABLE READ, nếu
command đã có một lệnh `SELECT` thường TRƯỚC lệnh khoá thì snapshot bị chốt trước lúc chờ khoá, và
các lần đọc sau khoá vẫn thấy dữ liệu cũ.
Mẫu này áp cho mọi ràng buộc dạng "tối đa N dòng mỗi cha" về sau.

Luật chung: ràng buộc nào không ép được ở DB thì phải có test tích hợp chạy hai lệnh song song
chứng minh command giữ được nó, chứ không dựa vào kỷ luật của người viết.
