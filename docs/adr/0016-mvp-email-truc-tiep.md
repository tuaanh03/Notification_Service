# ADR-0016 — MVP: gửi email trực tiếp qua Microsoft Graph, at-most-once

**Trạng thái:** chấp nhận — 2026-09-19. Chi tiết triển khai: `implementation_plan.md`.

## Bối cảnh
Phase 1 dựng xong hạ tầng. MVP phục vụ app service nội bộ gửi **email giao dịch cho từng người**,
người nhận bật/tắt được theo topic. Tài liệu kiến trúc gốc thiết kế cho campaign hàng loạt (segment,
chia lô, duyệt gửi) — quá nặng cho giai đoạn này.

## Quyết định

| # | Quyết định |
| --- | --- |
| D1 | Chỉ kênh email; địa chỉ qua `normalizeEmail` (ADR-0008) |
| D2 | Provider: Microsoft Graph `sendMail` (client credentials, `Mail.Send`) + `MockEmailProvider`. Không SMTP |
| D3 | **At-most-once**: đã giao cho Graph thì không gửi lại; không chắc -> `failed` / `outcome_unknown` |
| D4 | Chỉ nội dung trực tiếp `{ subject, html, text? }`; `templates` sau MVP |
| D5 | Người nhận chỉ theo `external_id` (có user -> có subscription -> có L0/L1/L3) |
| D6 | Topic do admin tạo; `/v1/topics` chỉ đọc (app không tự đặt `mandatory` để lách opt-out) |
| D7 | Consent kiểm ở worker ngay trước lúc gửi; API luôn 202 trừ lỗi input |
| D8 | Dùng lại `channelGate` + `effectiveOptIn` (ADR-0010), không viết rule mới |
| D9 | Route theo `external_id`; mỗi user một email mỗi app |
| D10 | `sent` = Graph đã nhận (202), không phải đã vào hộp thư; bounce xử lý sau MVP |

Ngoài phạm vi: segments, persons/identity resolver, broadcast/chia lô, send_approvals, templates, xử lý
bounce, trang `/u/:token`, hẹn giờ, Huỷ/Dừng, đăng nhập admin + RBAC.

## Hệ quả kỹ thuật (GĐ 0)

1. **Migration `0003`**: `notifications` thêm `target_user_id` (FK `users`), `subject` (VARCHAR 998 —
   giới hạn dòng header RFC 5322), `body_html`, `body_text` (MEDIUMTEXT). `payload` (≤ 2 KB) giữ nghĩa
   cũ: dữ liệu biến cho template. Domain: value object `EmailContent` (subject bắt buộc, body ≤ 256 KB).
2. **`StreamConsumer` thêm chế độ `idempotency: 'handler'`**. Chế độ mặc định (`'framework'`) bọc handler
   trong MỘT transaction cùng `processed_messages` — `uow.run` bên trong chỉ nhập vào đó, nên handler
   không commit được "đã nhận việc" trước khi gọi dịch vụ ngoài. At-most-once cần đúng điều ấy:
   tx1 `queued -> sending` COMMIT -> gọi Graph ngoài transaction -> tx2 ghi kết quả. Ở chế độ
   `'handler'` khung không mở transaction, không ghi `processed_messages`; handler tự khử trùng bằng
   conditional update trên status. Retry / DLQ / nhận lại message treo giữ nguyên.
3. **Giới hạn body theo route**: mặc định 64 KB; route gửi email khai `bodyLimit: LARGE_BODY_LIMIT_BYTES`
   (512 KB). Không nới giới hạn cho toàn API.
4. **ADR-0010 mở rộng** cho `notifications/domain/rules/email-gate.ts`.
