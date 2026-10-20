# ADR-0038 — Template: bật bộ kiểm HTML an toàn khi xuất bản kiểu `html`

**Trạng thái:** chấp nhận — 2026-10-20 (Vận hành-1, mục 3). Làm tiếp ADR-0036 §2.9 ("kiểu `html` chưa bật kiểm").

## 1. Bối cảnh

`checkEmailHtml` (ADR-0036) chặn HTML không an toàn ở kiểu `visual` lúc lưu nháp. Kiểu `html` (gõ tay / AI) chưa bị
kiểm: chỉ có luật nội dung lúc xuất bản. Đã chạy thử chỉ-đọc `admin-cli scan-template-html` trên production: sau bản
sửa UX-3 (Liquid trong thuộc tính) không còn version `html` nào bị chặn — đủ điều kiện bật.

## 2. Quyết định

1. **Kiểm lúc XUẤT BẢN, không lúc lưu nháp.** `PublishVersion` -> `TemplateVersion.publish(at, by, { checkHtml })` ->
   `validate({ checkHtml })`: kiểu `html` có HTML thì chạy thêm `checkEmailHtml`. Lỗi gộp với luật nội dung, cùng 422
   `VALIDATION` + `issues[]` (`HTML_TAG_NOT_ALLOWED`, `HTML_ATTRIBUTE_NOT_ALLOWED`, `HTML_URL_NOT_ALLOWED`,
   `IMAGE_URL_NOT_ALLOWED`, `HTML_STYLE_NOT_ALLOWED`, `HTML_MALFORMED`, `HTML_TOO_LARGE`, `path = html`) — đúng dạng kiểu
   `visual` trả lúc lưu, console đã có câu dịch. Nháp vẫn lưu được (nháp lỏng / xuất bản chặt — ADR-0020). Chỉ TỪ CHỐI,
   không sửa HTML (kể cả `normalizeLiquid` — kiểu `html` giữ nguyên từng byte người soạn viết).
2. **Không đụng bản đã xuất bản**: chỉ nháp đang được xuất bản bị kiểm; bản `published` / `superseded` vẫn gửi như cũ.
   Nháp chép từ bản cũ ("tạo nháp từ bản này") là bản MỚI nên bị kiểm khi xuất bản.
3. **Công tắc an toàn**: cài đặt hệ thống `templates.html_check_enabled` (kiểu `bool` — thêm lại kiểu này vào danh mục
   ADR-0030, lỗi `SETTING_INVALID_BOOLEAN`), **mặc định BẬT**, Super Admin tắt ở `/admin/settings` hoặc
   `PUT /admin/system-settings`. Tắt = xuất bản kiểu `html` như trước. Đọc qua port `TemplateFeatures`
   (`SettingsTemplateFeatures` -> `SystemSettingsQueries.current()`, đệm 30 giây; đọc NGOÀI transaction khoá template).
   Mặc định nằm trong code nên **không cần migration**.
4. Kiểu `visual` không đổi (đã kiểm lúc lưu, không kiểm lại lúc xuất bản).

## 3. Hệ quả

- Template `html` có `<script>`, `on*`, `javascript:`, ảnh `http://`… không xuất bản được nữa (khi bật) — người soạn
  thấy từng lỗi kèm chi tiết backend (thẻ / thuộc tính nào). Template AI soạn đi qua đúng cửa này.
- `scan-template-html` vẫn là cách đo trước khi đổi bộ kiểm (chạy lại sau mỗi lần nới / siết danh sách cho phép).
