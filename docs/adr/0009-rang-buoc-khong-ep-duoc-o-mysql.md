# ADR-0009 — Ràng buộc không ép được ở MySQL, phải ép ở command

**Trạng thái:** chấp nhận — 2026-09-17.

Một số ràng buộc của thiết kế gốc dựa vào partial index của PostgreSQL. MySQL không có,
và không phải cái nào cũng mô phỏng được bằng generated column.

| Ràng buộc | Cách ép | Ghi chú |
| --- | --- | --- |
| Mỗi template tối đa 1 version `published` | **Ép được ở DB**: generated column `published_marker` (1 khi published, NULL khi không) + `UNIQUE (template_id, published_marker)` | NULL trong unique index của MySQL là khác nhau nên nhiều draft vẫn cùng tồn tại |
| Mỗi app tối đa **2** secret `active` | **Không ép được ở DB** | `AppSecret.assertCanAddActive(count)` phải được gọi trong CÙNG transaction với lần INSERT, sau khi `SELECT ... FOR UPDATE` |
| `notifications` unique idempotency khi key khác NULL | **Ép được ở DB** | MySQL coi mỗi NULL là khác nhau -> `UNIQUE (app_id, idempotency_key)` hành xử đúng như partial index |
| Partition `notification_recipients` theo tháng | **Hoãn** | MySQL bắt mọi khoá unique phải chứa cột partition -> sẽ buộc nhét `created_month` vào PK. Quyết định để lại cho ADR retention |

Luật chung: ràng buộc nào không ép được ở DB thì phải có test tích hợp chạy hai lệnh song song
chứng minh command giữ được nó, chứ không dựa vào kỷ luật của người viết.
