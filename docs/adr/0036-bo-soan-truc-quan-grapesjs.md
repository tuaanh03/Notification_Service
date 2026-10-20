# ADR-0036 — Template: bộ soạn trực quan GrapesJS + MJML, trình duyệt sinh HTML, backend kiểm

**Trạng thái:** chấp nhận — 2026-10-19 (đợt UX-2). Mở rộng ADR-0020, ADR-0034; thay ADR-0034 §2.2 RIÊNG cho
kiểu `visual`. **ADR-0037 (2026-10-20) bỏ §2.7** (cờ `templates.visual_editor_enabled` — kiểu `visual` luôn bật) và
làm xong §5 phần mẫu dựng sẵn / trình kéo-thả. **ADR-0038 (2026-10-20) làm §2.9**: kiểu `html` chạy bộ kiểm
lúc xuất bản, sau công tắc `templates.html_check_enabled` (mặc định bật).

## 1. Bối cảnh

Người dùng thấy trình kéo-thả tự viết (ADR-0034) khó dùng với người không biết code: không gõ chữ trên thư,
không hoàn tác, xem trước nằm xa khung soạn. Đã khảo sát OneSignal (nhúng Beefree) và so các bộ soạn mã nguồn
mở; người dùng chọn **nhúng GrapesJS** (`grapesjs` 0.23.8, BSD-3) + **`grapesjs-mjml`** 1.0.8 (BSD-3):
gõ chữ trực tiếp, thanh định dạng nổi, hoàn tác / làm lại, máy tính / điện thoại, MJML sinh HTML dạng bảng có
nhánh riêng cho Outlook. Không dùng Unlayer / Beefree vì nội dung thư nội bộ không đi qua dịch vụ ngoài
(ADR-0034 §1 giữ nguyên).

Khác ADR-0034: HTML do **trình duyệt** sinh (grapesjs-mjml chạy mjml-browser). Backend vẫn phải giữ được
"thứ đã kiểm là thứ được gửi" — nên backend KIỂM chính chuỗi HTML sẽ lưu và gửi.

Ràng buộc giữ nguyên: worker, `/v1`, `RenderTemplate`, incoming webhook không biết có kiểu soạn mới; cột
`html` / `text` vẫn là nguồn gửi; luật nội dung (`template-variables.ts`) chạy lúc xuất bản như cũ.

## 2. Quyết định

1. **Kiểu soạn thứ ba `visual`** (migration 0026: ENUM `template_versions.editor` thêm `visual`;
   `TEMPLATE_EDITORS` ở `shared/kernel/enums.ts`). Đi theo VERSION như `blocks`. **Không thêm cột**: dùng lại
   `template_versions.design` (JSON) với dạng
   `{ format: 'grapesjs-mjml', version: 1, project: <JSON dự án GrapesJS>, mjml: <MJML xuất ra> }`
   (`VisualDesign`, `domain/types/visual-design.ts`). `project` để mở lại đúng như lúc soạn (kể cả chip biến),
   `mjml` để đọc / chuyển sau này không cần GrapesJS. Backend không hiểu `project`, chỉ kiểm là object + cỡ.
2. **Trình duyệt sinh HTML, backend kiểm rồi TỪ CHỐI — không âm thầm sửa.** `PUT …/:id/draft` kiểu `visual`
   nhận `{ editor:'visual', subject, html, design, variables }` (`strict`, KHÔNG nhận `text`). Lưu nháp chạy
   `draftContent` (domain, hàm thuần): `checkVisualDesign` + `checkEmailHtml` -> có lỗi là 422 `issues[]`
   (`code` + `path`), không ghi gì; qua thì `normalizeLiquid` rồi `emailHtmlToText` sinh `text`.
   **Đây là ngoại lệ của ADR-0034 §2.2** ("client không gửi html") — chỉ cho kiểu `visual`; kiểu `blocks` giữ
   nguyên luật cũ. Xuất bản vẫn chạy đúng `TemplateVersion.validate()`, không đổi một dòng.
3. **`checkEmailHtml()`** (`domain/rules/email-html.ts`) — danh sách CHO PHÉP, không phải danh sách cấm:
   - Thẻ: bảng, khối chữ, `a`, `img`, `style`, `meta`, `title` + vài thẻ Outlook (`o:*`, `v:*`, `w:anchorlock`,
     `noscript`, `xml` mà MJML sinh). Thẻ khác (`script`, `iframe`, `svg`, `form`, `link`, `base`…) ->
     `HTML_TAG_NOT_ALLOWED`.
   - Thuộc tính: danh sách cố định + `data-*` / `aria-*`; mọi `on*` và thuộc tính lạ -> `HTML_ATTRIBUTE_NOT_ALLOWED`;
     `http-equiv` chỉ `Content-Type` / `X-UA-Compatible`.
   - Link (`href`): giải entity, bỏ ký tự điều khiển rồi mới xét scheme; scheme khác `https` / `http` / `mailto`
     -> `HTML_URL_NOT_ALLOWED`. Lúc LƯU chỉ chặn scheme nguy hiểm (`javascript:`, `data:`…) — `http://` /
     link tương đối vẫn lưu được và `validateLinks` báo lúc xuất bản như mọi kiểu (nháp lỏng, xuất bản chặt).
   - Ảnh (`src`, `background`, `url()` trong CSS): chỉ `https://`, không biến -> `IMAGE_URL_NOT_ALLOWED`
     (cùng mã ADR-0034). **Không có tải ảnh lên** — chỉ dán link.
   - CSS (`style="…"` và `<style>`): cấm `expression(`, `javascript:`, `behavior`, `-moz-binding`, `@import`,
     ký tự thoát `\` -> `HTML_STYLE_NOT_ALLOWED`. Font ngoài (Google Fonts) vì thế bị chặn — console tắt font
     ngoài của MJML.
   - **Đọc cả phần trong `<!--[if mso]> … <![endif]-->` và KHÔNG xoá nó** — xoá là hỏng thư trên Outlook.
     Mọi chú thích đều được quét như HTML, nên không giấu được thẻ trong chú thích.
   - Không đọc nổi (thẻ thiếu `>`, nháy không đóng, chú thích không đóng, `<?…?>`, `<!ENTITY>`, `{% %}`) ->
     `HTML_MALFORMED`. Cỡ > 256 KB UTF-8 (như `MAX_EMAIL_BODY_BYTES`, ADR-0016) -> `HTML_TOO_LARGE`.
     Báo tối đa 20 lỗi, không lặp; `path` = `html`.
   - **Không thêm gói** (đã cân nhắc `htmlparser2`): domain không được import package ngoài (luật kiến trúc),
     và hàm này chỉ QUÉT thẻ chứ không dựng cây. Bộ quét tự viết cố ý khắt khe — thứ không hiểu chắc chắn là
     từ chối. Bộ lọc kiểu `sanitize-html` không hợp: nó xoá chú thích (hỏng Outlook) và sửa âm thầm.
4. **`normalizeLiquid()`** — ngoại lệ DUY NHẤT backend sửa HTML: bên trong `{{ … }}`, `&quot;` / `&#34;` /
   `&apos;` / `&#39;` -> `'` và `&amp;` -> `&`. GrapesJS ghi `"` trong thuộc tính thành `&quot;`, mà
   `renderTemplate` đọc chuỗi thô nên sẽ hiểu sai giá trị mặc định; `'` cùng nghĩa trong Liquid (như
   ADR-0034 §5). Ngoài `{{ }}` giữ nguyên từng byte.
5. **`emailHtmlToText()`** — bản chữ thường do backend sinh: bỏ `<head>`, mọi chú thích (nhánh Outlook trùng
   nội dung), thẻ; link thành "chữ (link)" khi chữ khác link; giữ biến. Người soạn không sửa tay (như `blocks`).
6. **Giới hạn**: HTML ≤ 256 KB (UTF-8); `project` ≤ 200 000 ký tự JSON, `mjml` ≤ 64 000 ký tự
   (`VISUAL_DESIGN_LIMITS`, `DESIGN_TOO_LARGE` ở `design.project` / `design.mjml`). Cả body vẫn chịu
   `LARGE_BODY_LIMIT_BYTES` 512 KB — **không nới**; thư gần trần 256 KB HTML thì body có thể vượt -> 413.
7. **Cờ bật / tắt là cài đặt hệ thống** `templates.visual_editor_enabled` (ADR-0030, kiểu mới `bool`, mặc định
   **tắt**, chỉ Super Admin chỉnh ở `/admin/settings`, lỗi `SETTING_INVALID_BOOLEAN`). Không dùng env: bật / tắt
   không phải deploy, có audit, cả console lẫn backend đọc cùng một nguồn. Cờ chỉ chặn **tạo mới** kiểu `visual`
   (`POST …/templates` -> 403 `VISUAL_EDITOR_DISABLED`). Template trực quan đã có vẫn mở / lưu / xuất bản /
   tạo nháp từ bản cũ / nhân bản được khi cờ tắt — không khoá người ta khỏi dữ liệu của mình.
   Console đọc cờ qua `GET /admin/template-editor-options` -> `{ visualEditor }` (quyền `catalog.read`, ai
   đăng nhập cũng có — cờ không phải bí mật). Templates đọc settings qua port `TemplateFeatures` (adapter
   gọi `SystemSettingsQueries.current()`, đệm 30 giây).
8. **Tạo**: `POST …/templates` nhận `editor:'visual'`; bỏ trống `html` + `design` = thư trống (console dựng thư
   mở đầu), gửi thì phải gửi cả hai (422 nếu thiếu một). Nháp khác kiểu -> 409 `EDITOR_MISMATCH` như `blocks`;
   `convert-to-html` chỉ cho `blocks` (visual -> 409 `EDITOR_MISMATCH`). Nhân bản / tạo nháp từ bản cũ chép
   `editor` + `design` như mọi kiểu (ADR-0034 §9).
9. **Kiểu `html` chưa bật bộ kiểm.** Template HTML tay / AI đang có (cả production) có thể chứa thứ bộ kiểm sẽ
   chặn. Thay vì bật ngay, có lệnh CHẠY THỬ chỉ đọc:
   `node dist/src/entrypoints/admin-cli/main.js scan-template-html` — quét MỌI version kiểu `html`, in
   template nào sẽ bị chặn và vì sao, không ghi gì. Bật cho `html` là quyết định sau khi đọc kết quả.

## 3. Hệ quả

- Console có kiểu soạn thứ ba "Trực quan (thử nghiệm)": GrapesJS nạp động chỉ ở trang soạn, khung giữa là thư
  thật; biến hiện thành chip (`project` giữ chip, MJML / HTML giữ Liquid). Luật console "HTML thư do BACKEND
  sinh" có ngoại lệ cho kiểu này — console không tự viết hàm sinh HTML, chỉ gọi grapesjs-mjml.
- Phiên bản GrapesJS / MJML ở console quyết định HTML được sinh ra. Nâng phiên bản là đổi HTML của nháp lưu
  SAU đó; bản đã xuất bản không đổi (HTML là bằng chứng thư đã gửi, như ADR-0034 §3).
- `checkEmailHtml` khắt khe: HTML MJML mới (thẻ / thuộc tính chưa gặp) có thể bị chặn sau khi nâng
  grapesjs-mjml -> thêm vào danh sách cho phép kèm test bằng HTML thật (`test/unit/fixtures/`).
- Kiểu `blocks` và 12 mẫu dựng sẵn không đổi trong đợt này.

## 4. Bổ sung UX-3 (2026-10-19)

1. **Biến trong thuộc tính là khối kín.** `checkEmailHtml` đọc giá trị thuộc tính có nháy, gặp `{{` thì nhảy tới
   `}}` rồi mới tìm nháy đóng — `"` bên trong `{{ }}` KHÔNG kết thúc thuộc tính. Đây là kiểu viết thật của người
   soạn HTML: `style="background-color:{{ payload.accent | default: "#F87171" }};"`. Đổi lại, `{{ … }}` trong
   thuộc tính phải ĐÚNG dạng biến (`{{ path }}` hoặc `{{ path | default: "…" }}` / `'…'`, giá trị mặc định không
   có `<` `>` `{` `}`; `&quot;` giải mã trước khi so) — sai dạng là `HTML_MALFORMED`. Vì vậy không giấu được
   `onerror=` / `<script>` trong `{{ }}` của thuộc tính; `{{ }}` trong CHỮ vẫn được quét như HTML (giấu thẻ trong
   giá trị mặc định vẫn bị `HTML_TAG_NOT_ALLOWED` / `HTML_ATTRIBUTE_NOT_ALLOWED`). Áp cho mọi kiểu đang dùng bộ kiểm
   (`visual`; lệnh chạy thử `scan-template-html` cho kiểu `html`).
2. Console (không đổi hợp đồng backend): bảng trái / phải tự dựng (Khối · Bố cục · Cài đặt thư; thuộc tính theo
   loại khối, "Nâng cao" mới có px / mã màu), chip có nhãn (mô tả biến, không có thì tên tự sinh), hộp "Chèn biến"
   khai biến mới vào bảng biến (mô tả = tên dễ đọc, giá trị mẫu = ví dụ), chip trong ô tiêu đề, lỗi từng khối
   kiểm phía trình duyệt (chỉ để báo sớm — backend vẫn là cổng chặn). "Cài đặt thư" lưu trong JSON dự án
   (`project.ewsSettings`) — backend không đọc, chỉ kiểm cỡ như mọi phần của `project`.

## 5. Chưa làm

Chuyển `blocks` -> `visual` một chiều khi mở + mẫu dựng sẵn ra MJML (`designToMjml`, UX-4) · xoá trình kéo-thả tự
viết (sau UX-4) · bật bộ kiểm cho kiểu `html` (chờ kết quả `scan-template-html`) · AI cho kiểu `visual` · tải ảnh
lên (người dùng đã bỏ) · bảng thao tác riêng cho điện thoại (bản phác DienThoai) · hàng đã lưu (saved rows).
