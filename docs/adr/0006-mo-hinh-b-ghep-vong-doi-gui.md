# ADR-0006 — Lõi danh tính mô hình B, ghép vòng đời gửi của mô hình A

**Trạng thái:** chấp nhận — 2026-09-17.

## Bối cảnh
`docs/` chứa hai mô hình dữ liệu mâu thuẫn. Người dùng chốt **mô hình B**.
Nhưng B chỉ là tài liệu về danh tính và consent: nó **không có** state machine 11 trạng thái,
`notification_recipients`, `notification_transitions`, `template_versions`, `delivery_batches`,
`bounce_events`, `audit_log`, `outbox`, `app_secrets`, `send_approvals`.
Bản thân file schema B cũng tự ghi chú là mất phần định nghĩa `organizations`, `apps`,
`persons`, `admins`, `admin_app_roles` và đầu bảng `users`.

## Quyết định
- **Lõi tenancy/danh tính lấy từ B**: `accounts` → `organizations` → `apps`/`persons` → `users`,
  targeting bằng `segments`, consent bằng `topics` + `user_topic_preferences`.
- **Vòng đời gửi lấy từ A**, ghép lên khoá của B.
- Phần tenancy bị mất đã được dựng lại trong `src/modules/tenancy` và `src/modules/apps`.

## Ranh giới module thay đổi so với tài liệu A
| Thay đổi | Lý do |
| --- | --- |
| Thêm `tenancy` | A không có tầng org; không module nào của A sở hữu `accounts`/`organizations`/`admins` |
| Thêm `segments`, giữ pipeline giải người nhận ở đó | B nhắm tin bằng `segments.filters`, không bằng `topic_bindings` của A |
| `topics` thu lại còn consent | B tách ba kho: tag = targeting, topic = consent, subscription = compliance |
| `directory` nhận thêm `persons` + `person_merge_log` | Identity Resolver sống ở đây; thay `user_merges` của A |

Tổng cộng 10 module.
