# ADR-0020 — Template: định danh bằng id, admin soạn và xuất bản, app chỉ gửi bằng bản đã xuất bản

**Trạng thái:** chấp nhận — 2026-09-30. Mở rộng ADR-0016 (MVP chỉ có nội dung trực tiếp).

## 1. Bối cảnh

Module `templates` có domain + bảng từ phase 0 nhưng chưa có đường vào. Console đã có màn Templates
dựng bằng dữ liệu giả, mô hình khác backend ở bốn chỗ: định danh bằng `key`, cú pháp biến ngắn
`{{vm_name}}`, "binding" template ↔ topic, và schema biến có kiểu / mặc định. Plan §12 mục 2.

## 2. Hai phần tách nhau, nối ở đúng một điểm

| | Soạn và xuất bản | Gửi thư bằng template |
| --- | --- | --- |
| Ai | Admin trên console | Code của app service |
| Xác thực | Phiên admin (ADR-0019) | API key |
| Bề mặt | `/admin/apps/:appId/templates…` | `POST /v1/notifications` (GĐ 2) |

Điểm nối duy nhất là **bản đã xuất bản**: app không thấy nháp, admin sửa bao lâu cũng không đổi thư
đang gửi. Hợp đồng giữa người soạn và đội app là `templateId` + danh sách biến bắt buộc.

## 3. Quyết định

1. **App gửi bằng `templateId` (UUID), bỏ hẳn cột `key`.** Một định danh duy nhất, tránh hiểu nhầm
   app gửi bằng key. Hệ quả: mỗi môi trường sinh id khác nhau — đội app cấu hình template id theo môi
   trường, cùng chỗ với API key.
2. **Tên template không trùng trong một app** (`uq_templates_app_name`). Collation `utf8mb4_0900_ai_ci`
   nên "Cảnh báo VM" và "canh bao vm" là trùng — cố ý, hai tên như vậy làm admin nhầm.
3. **Không có binding template ↔ topic.** App chỉ định template lúc gửi; topic vẫn chỉ lo consent.
4. **Đổ biến lúc API nhận request** (GĐ 2), lưu nội dung đã đổ + `template_version_id` vào
   `notifications`. Worker gửi không đổi, at-most-once (ADR-0016) giữ nguyên, lịch sử thấy đúng thư đã gửi.
5. **Cú pháp biến giữ nguyên `{{ payload.x }}` / `{{ user.x }}`** của `template-variables.ts`. Cú pháp
   ngắn bị từ chối. Đợt này `user.*` chỉ có `user.external_id`; `user.tags.*` bị chặn lúc xuất bản
   (`USER_VARIABLE_NOT_SUPPORTED`) vì app chưa có đường ghi tag — lọt qua là thư trống đúng chỗ đó.

## 4. Vòng đời version

- Mỗi template **tối đa 1 nháp** và **tối đa 1 bản published**. Published ép bằng generated column +
  unique index (ADR-0009); "1 nháp" không ép được ở DB nên mọi lệnh ghi **khoá dòng `templates`**
  (lọc cả `app_id`) rồi mới đọc version. Có test `race()` cho cả hai.
- **Nháp lưu được khi còn lỗi**, kiểm tra đầy đủ chạy lúc xuất bản -> 422 kèm `issues[]` (`code`, `path`):
  biến có nguồn, đã khai, biến tuỳ chọn có `| default:`, không tự viết footer / link huỷ đăng ký,
  link chỉ `https://` / `mailto:` (link bắt đầu bằng biến kiểm lại sau khi đổ biến lúc gửi).
- Xuất bản trong một transaction: bản cũ -> `superseded` trước, nháp -> `published` sau.
- "Sửa bản đã xuất bản" và "quay về bản cũ" đều là **tạo nháp mới chép từ version đó**; không sửa tại
  chỗ, không xoá version (lịch sử gửi trỏ tới nó).
- **Lưu trữ** (`archived`): không sửa / xuất bản / đổi tên / gửi được nữa. Chưa có đường bỏ lưu trữ.

## 5. Schema (migration 0006)

`templates`: bỏ `key` + `uq_templates_app_key`, thêm `uq_templates_app_name` — thêm unique mới TRƯỚC
khi xoá cũ vì FK `app_id` đang dựa vào index cũ. `template_versions`: `html` / `text` lên MEDIUMTEXT
(như `notifications.body_html`), thêm `created_by` / `published_by`. Biến khai thêm `sample` /
`description` (JSON, chỉ để xem thử — không dùng lúc gửi).

## 6. Gửi bằng template (GĐ 2)

`POST /v1/notifications` nhận `templateId` + `payload` THAY cho `subject` / `html` / `text` — trộn là
`CONTENT_AND_TEMPLATE_CONFLICT`, `payload` không kèm `templateId` là `PAYLOAD_REQUIRES_TEMPLATE`.

- **Đổ biến ở `AcceptEmailNotification`**, qua port `TemplateRenderer` -> use case công khai
  `RenderTemplate` của templates (notifications không đọc bảng templates). Kết quả đi qua CÙNG
  `emailContent()` với nội dung viết thẳng, rồi lưu vào `subject` / `body_html` / `body_text` kèm
  `template_version_id` + `payload`. Worker không đổi, không biết template tồn tại.
- **Luật đổ** (`renderTemplate`, hàm thuần): một lượt, giá trị không bị quét lại; html escape, subject /
  text giữ nguyên; thiếu biến bắt buộc / giá trị không phải chữ-số-bool gom hết vào một lỗi; biến tuỳ
  chọn dùng `| default:`; khoá thừa trong `payload` bỏ qua; link bắt đầu bằng biến kiểm lại sau khi đổ.
- **Mọi lỗi template là 422** (kể cả `TEMPLATE_NOT_FOUND`), như `TOPIC_NOT_FOUND`: request đúng đường,
  dữ liệu bên trong sai. Template của app khác = `TEMPLATE_NOT_FOUND`.
- `payload` được LƯU (tra lỗi, gửi lại sau này) nhưng không xuất hiện ở `/admin` lẫn `/v1` — có thể chứa
  dữ liệu cá nhân. Lịch sử gửi chỉ có `template: { id, name, version }`, tra nhãn theo lô.
- Trùng `idempotencyKey` trả bản cũ TRƯỚC khi đổ biến — không đổ lại, không gửi lại.

## 7. Chưa làm

Gửi thử · `user.tags.*` · app tự tạo template qua `/v1` · binding theo topic.
