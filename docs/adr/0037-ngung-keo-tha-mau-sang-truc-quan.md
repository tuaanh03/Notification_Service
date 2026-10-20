# ADR-0037 — Template: ngừng trình kéo-thả, bộ soạn trực quan luôn bật, mẫu dựng sẵn ra kiểu `visual`

**Trạng thái:** chấp nhận — 2026-10-20 (đợt UX-4). Thay ADR-0034 (trình kéo-thả) ở mọi phần TẠO / SỬA; sửa
ADR-0035 §2.1, §2.4 (mẫu ra `visual`); bỏ ADR-0036 §2.7 (cờ bật / tắt).

## 1. Bối cảnh

UX-2 / UX-3 (ADR-0036) đã có bộ soạn trực quan GrapesJS + MJML, sau cờ `templates.visual_editor_enabled` (mặc định
tắt). Trình kéo-thả tự viết (ADR-0034) thành thừa: hai bộ soạn cho cùng một việc, người dùng phải chọn. Người dùng
quyết định: bộ soạn trực quan là mặc định và luôn bật; trình kéo-thả xoá hẳn; 12 mẫu dựng sẵn (ADR-0035) tạo ra
template trực quan. Trên production chỉ có 3 template kiểu `blocks` (cùng app "Demo app service", chỉ nháp v1,
0 thư, 0 lần phát, 0 incoming hook) — người dùng đồng ý XOÁ HẲN thay vì chuyển đổi.

Ràng buộc: backend KHÔNG có trình biên dịch MJML (ADR-0036 §2.2: trình duyệt sinh HTML, backend kiểm). Thứ tự
deploy: migration chạy TRƯỚC app — nên không thể đổi ENUM `editor` trong cùng đợt với việc dọn dữ liệu.

## 2. Quyết định

1. **Ngừng kiểu `blocks` ở mọi đường GHI**: tạo (`POST …/templates`), lưu nháp (`PUT …/draft`), nhân bản, tạo nháp
   từ bản cũ — gặp `blocks` là 422 `EDITOR_NOT_SUPPORTED` (`assertEditorSupported`, domain; route bắt TRƯỚC zod để
   có mã rõ ràng thay vì lỗi hình dạng). Dòng `blocks` có sẵn vẫn ĐỌC được (chi tiết, danh sách, xuất bản / gửi bản
   đã có) — để lệnh dọn và màn danh sách không vỡ. `convert-to-html` và `design-preview` giữ tới deploy 2 (không tạo
   thêm `blocks`). `draftContent` / `DraftInput` không còn nhánh `blocks`.
2. **Bỏ cờ** `templates.visual_editor_enabled`: kiểu `visual` luôn tạo được. Gỡ khỏi danh mục cài đặt hệ thống (khoá
   cũ gửi lên -> `SETTING_UNKNOWN`; dòng cũ còn trong `system_settings` bị bỏ qua khi đọc), bỏ kiểu cài đặt `bool`
   (không còn khoá nào dùng — `SETTING_INVALID_BOOLEAN` không còn), bỏ port `TemplateFeatures` và route
   `GET /admin/template-editor-options` (console không còn đọc).
3. **`designToMjml(design)`** (`domain/rules/design-to-mjml.ts`, hàm thuần): `EmailDesign` -> MJML. Hàng ->
   `mj-section` (nền hàng / nền thư), cột -> `mj-column`, heading / text -> `mj-text`, button -> `mj-button`, image ->
   `mj-image` (bỏ nếu chưa có link), divider -> `mj-divider`, spacer -> `mj-spacer`, html -> `mj-raw`. Màu / cỡ / căn
   lề / font đặt TRÊN TỪNG KHỐI (khung soạn của grapesjs-mjml không dựng `<mj-head>` — như "Cài đặt thư" của console);
   font là font hệ thống trùng `EMAIL_FONTS` của console. Escape như `renderDesign`, biến `{{ }}` giữ nguyên, trong
   thuộc tính `"` của biến thành `'`. Thẻ luôn có thẻ đóng (bộ đọc của GrapesJS không hiểu `<… />`).
4. **Mẫu dựng sẵn -> `visual`, biên dịch ở TRÌNH DUYỆT.** Mẫu vẫn viết bằng `EmailDesign` (không viết lại 12 mẫu).
   - `GET /admin/template-presets` trả thêm `mjml` (`designToMjml`). `html` (`renderDesign`) giữ, CHỈ làm ảnh thu nhỏ.
   - Console bấm vào mẫu là dựng một GrapesJS KHÔNG giao diện (`headless`) với đúng plugin + cấu hình của bộ soạn
     (`compileMjml`, `components/templates/visual/compile-mjml.ts`): nạp MJML, lấy ra như lúc bấm Lưu — MJML
     (`getHtml`), HTML (`mjml-code-to-html`, `fonts: {}`), dự án (`getProjectData` + `ewsSettings` mặc định). Hộp xem
     trước hiện đúng HTML này; "Dùng mẫu" gửi nó.
   - `POST …/templates/from-preset` nhận `{ presetId, locale, name, html, design }` (`design` = `VisualDesign`,
     `bodyLimit` như lưu nháp). Tiêu đề / biến / nhóm backend lấy từ MẪU, không nhận từ client. Đi đúng `CreateTemplate`
     kiểu `visual` -> `checkEmailHtml` + `normalizeLiquid` + `emailHtmlToText` như mọi lần lưu trực quan (422 nếu không
     an toàn). Console cũ gửi thiếu `html` / `design` -> 422 (không tạo được template rỗng).
   - **Vì sao không phương án khác:** (a) backend tự biên dịch MJML — thêm gói `mjml` (~190 gói phụ) vào runtime và
     phải giữ hai bản mjml khớp nhau, trái ADR-0036; (b) backend tạo template `visual` với `html` = `renderDesign` +
     `design.mjml` không có dự án — HTML gửi đi KHÁC thứ bộ soạn sẽ sinh khi mở / lưu lại, `renderDesign` thành hàm
     sinh HTML thứ hai sống mãi cho dữ liệu `visual`; (c) chép HTML biên dịch sẵn vào code backend — lệch mỗi khi đổi
     mẫu / nâng grapesjs-mjml mà không ai biết. Phương án chọn: một nguồn HTML duy nhất (grapesjs-mjml ở trình
     duyệt, đúng bản đang soạn), backend vẫn là cổng kiểm, mở trong bộ soạn ra đúng các khối (dự án dựng từ chính MJML).
   - **Mẫu xuất bản được ngay**: test chạy MỌI mẫu × MỌI ngôn ngữ — MJML hợp lệ (soát cấu trúc trong test), HTML THẬT
     do `mjml-browser` (đúng gói của grapesjs-mjml) biên dịch (`test/unit/fixtures/preset-html.json`, sinh bằng
     `test/unit/fixtures/compile-preset-html.ts` với `validationLevel: 'strict'`) qua `checkEmailHtml` + `validate()`
     0 lỗi, biến khớp đúng biến đã khai. Test đòi `sha256(MJML hiện tại)` khớp file — sửa mẫu / `designToMjml` mà quên
     sinh lại là đỏ. `mjml-browser` KHÔNG thành dependency của backend: script đọc gói từ `node_modules` của console.
   - Mọi mẫu dùng cài đặt mặc định (`DEFAULT_DESIGN_SETTINGS`) = "Cài đặt thư" mặc định của console — test ép.
5. **Dọn dữ liệu cũ: `admin-cli purge-blocks-templates [--apply]`** (`PurgeBlocksTemplates`). Mặc định CHẠY THỬ
   (in template, app, tên, từng version, số thư / lần phát / incoming hook trỏ tới); `--apply` mới xoá. Mỗi template
   một transaction: khoá dòng `templates`, đọc lại version + chỗ dùng (có thể vừa có người gửi), xoá mọi
   `template_versions` rồi `templates`, audit `TemplatePurged` (`before` = app, tên, nhóm, version). Từ chối từng
   template: còn thư / lần phát / incoming hook trỏ tới (`referenced` — lịch sử gửi không được mất; khoá ngoại cũng
   chặn) hoặc có version kiểu khác `blocks` (`mixed_editors` — vd nháp đã chuyển sang HTML, xoá là mất bản đang dùng).
   Có template bị từ chối thì lệnh trả mã thoát 2. Đếm chỗ dùng qua query công khai của `notifications`
   (`CountTemplateUsage`) và `incoming` (`CountHooksByTemplate`) — không query bảng module khác.
6. **Hai đợt deploy**:
   - **Deploy 1** (đợt này): mọi điều trên; ENUM `editor` vẫn có `blocks`; console bỏ trình kéo-thả (template `blocks`
     còn sót mở ra chỉ đọc HTML đã lưu + dải "Kiểu soạn cũ đã ngừng — template này sẽ được dọn"). Sau deploy: chạy thử
     `purge-blocks-templates`, đọc kết quả, rồi `--apply`.
   - **Deploy 2** (sau khi dọn xong): migration 0027 — KIỂM `editor = 'blocks'` còn dòng nào thì FAIL với thông báo
     rõ (không âm thầm), rồi ENUM = (`html`, `visual`); gỡ `blocks` khỏi `TEMPLATE_EDITORS`, gỡ `convert-to-html`,
     `design-preview`, schema zod của thiết kế và lệnh dọn. `EmailDesign` + `renderDesign` + `designToMjml` giữ cho mẫu
     dựng sẵn (định dạng viết mẫu + ảnh thu nhỏ).

### Bổ sung deploy 2 (làm xong)

- Migration `0027_blocks_editor_removed`: câu đầu `ADD CONSTRAINT chk_no_blocks_left__run_admin_cli_purge_blocks_templates_apply
  CHECK (editor <> 'blocks')` — còn dòng `blocks` thì MySQL dừng với "Check constraint '…' is violated" (tên ràng buộc
  là lời nhắn), chưa đổi gì; qua thì gỡ ràng buộc, `MODIFY` ENUM = (`html`, `visual`), xoá dòng cũ
  `system_settings.templates.visual_editor_enabled`. Không dùng stored procedure + `SIGNAL` (cần quyền `CREATE ROUTINE`
  mà tài khoản migrate chưa chắc có). Test: `migrations.test.ts` dựng DB ở mốc 0026 có dòng `blocks` -> dừng đúng lời
  nhắn, ENUM giữ nguyên; dọn xong chạy lại -> qua.
- Gỡ: `blocks` khỏi `TEMPLATE_EDITORS`, `TemplateDesign` (chỉ còn `VisualDesign`), `convertToHtml` / `ConvertDraftToHtml`
  / `POST …/draft/convert-to-html`, `PreviewDesign` / `POST …/templates/design-preview`, `email-design.schema.ts`,
  `assertEditorSupported` (gửi `editor: 'blocks'` nay là 422 hình dạng như mọi giá trị lạ).
- **Gỡ lệnh `purge-blocks-templates`** cùng `TemplatePurged` và hai query đếm chỗ dùng (`CountTemplateUsage`,
  `CountHooksByTemplate`): sau 0027 không thể còn dòng `blocks`, lệnh không còn việc; giữ lại là code chết có quyền xoá
  dữ liệu. Audit các lần dọn đã ghi vẫn còn trong `audit_log`.
- Giữ: `EmailDesign`, `renderDesign` (ảnh thu nhỏ), `checkDesign` (test mẫu), `designToMjml`, `draftContent`.
- Console: bỏ `blocks` khỏi `TEMPLATE_EDITORS`, bỏ màn chỉ đọc kiểu cũ + dải "Kiểu soạn cũ đã ngừng".

## 3. Hệ quả

- Console: màn tạo mới có 2 kiểu — Trực quan (mặc định) và HTML. Không còn `@dnd-kit`, `components/templates/blocks/*`,
  `use-design-preview`, `lib/email-design.ts`, công tắc cờ ở Cài đặt hệ thống.
- Template tạo từ mẫu: HTML là của grapesjs-mjml (giống thứ bộ soạn sinh khi lưu lại); ảnh thu nhỏ trong thư viện vẫn
  là `renderDesign` — gần giống, không trùng từng điểm ảnh (hộp xem trước thì trùng). Nâng grapesjs-mjml thì sinh lại
  `preset-html.json` và chạy test (bộ kiểm có thể chặn HTML mới — ADR-0036 §3).
- Mẫu đổi về sau KHÔNG đổi template đã tạo (ADR-0035 §2.5 giữ nguyên); audit `TemplateCreated` vẫn có
  `after.createdFromPreset`, nay `editor: 'visual'`.
- Không còn đường nào sinh dòng `blocks` mới — điều kiện để migration 0027 an toàn.

## 4. Chưa làm

Ảnh trong mẫu · mẫu do tổ chức tự lưu · AI cho kiểu `visual` · bật bộ kiểm cho kiểu `html` (ADR-0036 §2.9).
