# Gửi thông báo qua EWS bằng webhook

Dành cho hệ thống chỉ biết gọi webhook (công cụ giám sát, script, công cụ tự động hoá). Không cần API key.
Bản đầy đủ: `huong-dan-tich-hop-cho-doi-app.md`, mục 6 — cách 3.

Console: `https://ews-astrolink.eonsr.net`

## Trước khi bắt đầu

- App của bạn đã có trên EWS, có **chủ đề** (topic) và **người nhận đã khai email**.
- Thư đi tới **mọi người đang theo dõi topic** đã chọn. Chạy thử bằng một topic chỉ có chính bạn.

## Bước 1 — Template

**Templates → Tạo template** → soạn tiêu đề, nội dung, dùng biến `{{ payload.<tên> }}` (ví dụ
`{{ payload.title }}`) → **Xuất bản v…**. Chỉ bản đã xuất bản mới dùng được.

## Bước 2 — Tạo webhook

**Cài đặt App → Webhooks → tab Nhận vào → Thêm webhook** → chọn **Topic** và **Template** → **Tạo**.

## Bước 3 — Lấy URL và body

Bấm vào webhook vừa tạo:

- **Body mẫu**: các trường phải gửi (trường nào bắt buộc) và thư mẫu người nhận sẽ thấy.
- **Sao chép URL**: dạng `https://api-ews-astrolink.eonsr.net/hooks/ewshk_…`.

URL là chìa khoá — không dán vào chỗ công khai. Lộ thì bấm **Đổi URL** (URL cũ ngừng ngay).

## Bước 4 — Cấu hình hệ thống gọi

| | |
| --- | --- |
| Phương thức | `POST` |
| URL | URL ở bước 3 |
| Header | `Content-Type: application/json` |
| Body | JSON có trường **trùng tên biến** của template (bỏ `payload.`) |

```bash
curl -X POST '<URL>' -H 'Content-Type: application/json' \
  -d '{"title":"VM web-01 quá tải","name_issue":"CPU > 95% trong 5 phút"}'
```

Giá trị là chữ, số hoặc `true` / `false`. Trường thừa bị bỏ qua.

## Bước 5 — Kiểm tra

Webhook → **Nhật ký**: mỗi lần gọi ghi một dòng ("Đã gửi cho 2 người", "Thiếu trường bắt buộc: name_issue"…).

| HTTP | Nghĩa |
| --- | --- |
| 202 | Đã nhận, đang gửi |
| 200 `duplicate` | Trùng lần trước — không gửi lại (cùng body trong 10 phút, hoặc cùng header `Idempotency-Key`) |
| 404 | URL sai, webhook đã tắt hoặc đã xoá |
| 422 | Thiếu / sai trường (`MISSING_VARIABLE`, `INVALID_PAYLOAD_VALUE`), body không phải JSON object, hoặc template / topic chưa sẵn sàng |
| 429 | Quá 20 lần gửi mỗi phút |
