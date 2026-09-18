# ADR-0007 — Ba phân xử đặt tên giữa mô hình A và B

**Trạng thái:** chấp nhận — 2026-09-17.

| Xung đột | Chốt | Lý do |
| --- | --- | --- |
| B `messages` vs A `notifications` | **`notifications`** | `messages` của B chỉ là phác thảo sơ. Toàn bộ 11 trạng thái, `lib/theme.ts` của FE và route `/notifications` dựng trên tên này. `message_segments` → cột `included_segments`/`excluded_segments` trên `notifications`. |
| B `subscriptions.type` + `token` vs A `channel` + `value` | **`channel` + `value`** | Khớp `apps.granted_channels` và FE; giữ tên B thì mọi chỗ khác phải dịch qua lại. |
| B `is_subscribed` (bool) vs A `status` enum | **`status` enum**, cộng `opted_out_optional` + `suppressed_reason` của B | BR-9 nói rõ *unsubscribed ≠ invalid*; một bool không diễn đạt được. Ba cột trả lời ba câu khác nhau: kênh còn sống không, có tắt tin không bắt buộc không, và vì sao bị chặn. |
