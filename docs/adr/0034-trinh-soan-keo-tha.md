# ADR-0034 — Template: trình soạn kéo-thả, thiết kế JSON theo version, backend sinh HTML

**Trạng thái:** chấp nhận — 2026-10-18 (đợt 2 của ADR-0033). Mở rộng ADR-0020.

## 1. Bối cảnh

Người dùng muốn soạn template email kiểu OneSignal: kéo khối vào hàng / cột, không phải viết HTML.
Hôm nay template chỉ soạn bằng HTML tay hoặc nhờ AI (ADR-0020 §7). Đã chốt với người dùng: tự dựng
trình khối (không dùng Unlayer / Beefree — nội dung thư nội bộ không đi qua dịch vụ ngoài), ảnh chỉ
bằng link `https://`, bản chữ thường tự sinh, chỉ chuyển một chiều kéo-thả -> HTML.

Ràng buộc phải giữ: thứ đã kiểm lúc xuất bản là thứ được gửi; worker, `/v1`, `RenderTemplate` không
biết có kiểu soạn mới; luật nội dung (`template-variables.ts`) không viết lại ở chỗ khác.

## 2. Quyết định

1. **Version mang kiểu soạn** (migration 0025): `template_versions.editor` ENUM(`html`, `blocks`)
   NOT NULL DEFAULT `html` (dòng cũ thành `html`), `template_versions.design` JSON NULL (null khi
   `html`). Khai `TEMPLATE_EDITORS` trong `shared/kernel/enums.ts`. Kiểu soạn đi theo VERSION, không
   theo template: chuyển sang HTML chỉ đổi nháp, bản đã xuất bản giữ nguyên.
2. **Cột `html` / `text` vẫn là nguồn gửi.** Lưu nháp kiểu `blocks`: backend sinh `html` + `text` từ
   `design` bằng hàm thuần `renderDesign()` (`templates/domain/rules/email-design.ts`) rồi ghi vào
   đúng hai cột cũ. Client không gửi `html` / `text` ở kiểu này — có gửi cũng bị từ chối (`strict`).
   Vì thế xuất bản chạy đúng `TemplateVersion.validate()` hiện có trên HTML đã sinh; `renderTemplate`,
   worker, `/v1`, incoming webhook không đổi; đội app không phải sửa gì.
3. **Thiết kế JSON**, có `version` để đổi cấu trúc sau này:
   ```
   { version: 1,
     settings: { width 480–600, backgroundColor, contentBackgroundColor, textColor, linkColor,
                 fontFamily: 'sans' | 'serif' | 'mono' },
     rows: [ { id, backgroundColor?, columns: [ { id, blocks: [Block…] } ]  // 1–3 cột
   ```
   Khối: `heading` (text, level 1–3, align, color?) · `text` (text, align, color?; trong chữ có
   `**đậm**` và `[chữ](link)`, xuống dòng là `<br>`) · `button` (label, url, align, màu nền, màu chữ,
   bo góc) · `image` (src `https://`, alt tuỳ chọn — HTML luôn có thuộc tính `alt`, rỗng nếu trống;
   rộng % của cột, vẫn co lại trên điện thoại bằng `max-width:100%; height:auto`; link tuỳ chọn, align) · `divider` (màu, độ
   dày) · `spacer` (cao) · `html` (HTML tự viết). Màu chỉ nhận `#rrggbb`, số đều có khoảng — không có
   ô CSS tự do. `id` do console sinh (khoá kéo-thả), backend chỉ kiểm hình dạng.
4. **HTML sinh ra dạng bảng, style inline**, rộng tối đa 600px, chạy được trên Outlook bản Windows. Cột
   dùng kiểu "fluid hybrid": mỗi cột `inline-block` có `max-width` = rộng / số cột, Outlook nhận bảng
   ẩn trong `<!--[if mso]>`. Màn hẹp thì cột **tự xếp chồng**, không cần media query (Gmail app hay bỏ).
   Thiết kế không có hàng nào -> `html` = `text` = rỗng, nên xuất bản vẫn báo `HTML_REQUIRED`.
5. **Thoát ký tự mọi chữ người dùng nhập**, TRỪ khối `html`. Biến `{{ … }}` giữ nguyên để
   `renderTemplate` đổ lúc gửi (giá trị biến vẫn được escape lúc đó như hôm nay). Biến nằm trong
   thuộc tính (`href`) thì `"` trong biến đổi thành `'` (`| default: "x"` -> `'x'`, cùng nghĩa) để
   không vỡ thuộc tính.
6. **Biến dùng được** trong chữ, tiêu đề khối, nhãn nút, link nút, link trong chữ, link của ảnh. Link
   KHÔNG kiểm lúc lưu nháp — nó vào `href` của HTML đã sinh, `validateLinks` bắt lúc xuất bản
   (`https://` / `mailto:` / bắt đầu bằng biến), như HTML tay. **`src` của ảnh thì kiểm ngay lúc
   lưu**: chỉ `https://` hoặc rỗng, không biến (`validateLinks` chỉ xem `href`, ảnh sai sẽ lọt) ->
   422 `IMAGE_URL_NOT_ALLOWED`. Ảnh chưa có link thì không sinh gì.
7. **Giới hạn** (kiểm ở domain `checkDesign()` lúc lưu / xem trước, mã ổn định): ≤ 40 hàng, ≤ 100 khối
   cả thư, ≤ 64 000 ký tự JSON (`DESIGN_TOO_LARGE`), chữ một khối ≤ 5 000, khối `html` ≤ 32 000.
   Đủ để HTML sinh ra nằm dưới 256 KB của `EmailContent` (ADR-0016). Không nới `bodyLimit`.
   Hình dạng sai (khối lạ, thiếu trường, màu sai) là 422 `INVALID_FIELD` từ zod ở route — zod chỉ
   được ở tầng interface (luật kiến trúc), nên schema zod nằm ở `interface/http/`, kiểu + giới hạn +
   hàm sinh ở domain.
8. **Route** dưới `/admin/apps/:appId/templates` (ADR-0022):
   - `PUT …/:id/draft` nhận thêm `editor` (bỏ trống = `html`, client cũ chạy như cũ). Kiểu `blocks`:
     `{ editor, subject, design, variables }`. Nháp đang có khác kiểu -> 409 `EDITOR_MISMATCH`
     (không đổi kiểu bằng lưu nháp).
   - `POST …/templates` nhận thêm `editor`; `blocks` mà chưa có `design` thì nháp v1 là thiết kế rỗng.
   - `POST …/templates/design-preview` (`app.read`, `bodyLimit` như `PUT …/draft`): `{ design }` ->
     `{ html, text }`. Không ghi DB, không cần template; cùng giới hạn domain (`DESIGN_TOO_LARGE`…) như
     lúc lưu. Console gọi có debounce (~500 ms) và bỏ kết quả của lần gọi cũ về muộn (tránh nhấp
     nháy); KHÔNG chép hàm sinh sang console — một nguồn duy nhất.
     Console vẫn thay giá trị mẫu của biến trên HTML trả về như màn HTML hiện tại.
   - `POST …/:id/draft/convert-to-html` (`app.manage`): nháp `blocks` -> `html`, giữ `html` / `text`
     đã sinh, `design` = null. Một chiều, console có hộp xác nhận nói rõ: không quay lại kéo-thả được;
     chỉ NHÁP chuyển, bản đã xuất bản không đổi. Không có nháp -> 409 `NO_DRAFT`;
     nháp đã là `html` -> 409 `EDITOR_MISMATCH`. Audit `TemplateDraftSaved` với
     `after.convertedToHtml = true`. **Không có chiều HTML -> kéo-thả**: không dựng lại khối từ HTML tự do.
9. **Chép theo version**: `editor` + `design` nằm trong `TemplateContent`, nên "tạo nháp từ bản cũ"
   (ADR-0020 §4) và nhân bản (ADR-0033) tự chép cả hai.
10. **AI soạn tắt ở kiểu `blocks`**: console ẩn nút "Nhờ AI soạn". Route AI giữ nguyên (chỉ đề xuất,
    không ghi), dùng cho kiểu HTML. Muốn dùng AI thì chuyển sang HTML trước.

## 3. Hệ quả

- Màn soạn console có hai kiểu: `html` (như cũ) và `blocks` (bảng khối trái · khung soạn giữa · thuộc
  tính phải, `@dnd-kit`). Màn tạo mới chọn kiểu soạn, mặc định Kéo-thả.
- Bản chữ thường ở kiểu `blocks` không sửa tay được; muốn sửa tay thì chuyển sang HTML.
- HTML đã sinh của bản đã xuất bản là bằng chứng thư gửi đi: đổi `renderDesign()` sau này KHÔNG sinh
  lại version cũ. Nháp chỉ sinh lại khi lưu.
- `design.version` tăng khi đổi cấu trúc; hàm đọc phải nhận được mọi bản cũ còn trong DB.

## 4. Chưa làm

AI cho kiểu `blocks` · HTML -> kéo-thả · tải ảnh lên · biến trong `src` ảnh · ẩn hàng theo thiết bị ·
saved rows · Brand Kit · undo / redo nhiều bước · chỉnh độ rộng từng cột · gửi thử.
