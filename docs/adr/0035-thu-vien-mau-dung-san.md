# ADR-0035 — Template: thư viện mẫu dựng sẵn, viết trong code, chép một lần

**Trạng thái:** chấp nhận — 2026-10-19 (đợt 3 của ADR-0033). Mở rộng ADR-0020, dựa trên ADR-0034.

## 1. Bối cảnh

Đợt 1 (ADR-0033) có nhóm + nhân bản, đợt 2 (ADR-0034) có trình soạn kéo-thả. Người soạn vẫn phải bắt
đầu từ trang trắng: dựng khối, đặt biến, viết chữ hai thứ tiếng. OneSignal có thư viện mẫu theo chủ đề;
người dùng muốn tương tự cho các loại thư nội bộ hay gặp — cảnh báo, bảo mật, chào mừng, nhắc việc,
duyệt, báo cáo.

Ràng buộc phải giữ: mẫu là điểm khởi đầu, KHÔNG phải template dùng chung — sửa mẫu không được âm thầm
đổi thư của app đang gửi; nội dung mẫu phải qua đúng luật xuất bản (`validate()`), không có đường riêng.

## 2. Quyết định

1. **Mẫu viết trong code backend**, `templates/domain/presets/` (dữ liệu thuần, cạnh hàm sinh HTML),
   không có bảng, **không migration**. Mỗi mẫu: `id` cố định (kebab-case, vd `incident-alert`),
   `version` nguyên (tăng khi sửa nội dung), `category` (một trong 7 nhóm của ADR-0033), và cho mỗi
   ngôn ngữ `vi` / `en` (`PRESET_LOCALES`): `name`, `description` (một câu), `subject`, `design` (kiểu
   `blocks` của ADR-0034), `schema` (biến). Đổi mẫu = sửa code + deploy, như đổi luật.
2. **12 mẫu** cho 6 nhóm (nhóm `other` không có mẫu): cảnh báo sự cố · sự cố đã khắc phục (alert) ·
   đăng nhập từ thiết bị lạ · lịch bảo trì · đặt lại mật khẩu (system) · chào mừng · cấp tài khoản
   (onboarding) · nhắc hạn công việc · nhắc lịch họp (reminder) · có yêu cầu chờ duyệt · kết quả duyệt
   (approval) · báo cáo định kỳ (report, có một hàng 2 cột số liệu).
   - Khối chỉ `heading` / `text` / `button` / `divider` / `spacer`, 1–2 cột. Màu trung tính, nút một
     màu nhấn chung (`linkColor` mặc định) — dựng bằng bộ hàm `preset-design.ts`.
   - **Không có ảnh**: chưa có chỗ lưu ảnh (ADR-0034 §4), link ảnh ngoài thì mẫu phụ thuộc máy chủ lạ.
   - Biến đều là `payload.<key>` bắt buộc, có giá trị mẫu + mô tả theo ngôn ngữ. Link nút là biến
     (`{{ payload.detail_url }}`) — qua `validateLinks` lúc xuất bản, đổ xong kiểm lại như mọi link.
   - Không chữ "unsubscribe", không `{{ footer }}`: footer do hệ thống thêm.
3. **Mẫu phải xuất bản được ngay**: test unit chạy MỌI mẫu × MỌI ngôn ngữ qua `checkDesign`,
   `draftContent` (sinh HTML) và `TemplateVersion.validate()` với 0 lỗi; biến dùng trong tiêu đề /
   thư khớp đúng biến đã khai (không thiếu, không thừa); id duy nhất; đủ 12 mẫu, mỗi mẫu đủ vi + en.
4. **Route** (ADR-0022):
   - `GET /admin/template-presets?category=&locale=` — quyền mới `catalog.read` (ai đăng nhập cũng có,
     như `self.read`): thư viện không thuộc org / app nào. `locale` bỏ trống = `vi`, sai -> 422. Mỗi mẫu
     trả `id`, `version`, `category`, `locale`, `name`, `description`, `subject`, `variables`,
     `design` và `html` đã sinh bằng `renderDesign` (còn nguyên `{{ … }}`) — console làm ảnh thu nhỏ /
     xem trước, tự thay giá trị mẫu như màn soạn; KHÔNG chép hàm sinh sang console.
   - `POST /admin/apps/:appId/templates/from-preset` (`app.manage`, như tạo template), body
     `{ presetId, locale, name }`. Đi đúng `CreateTemplate`: template mới, nhóm của mẫu, kiểu `blocks`,
     nháp v1 = thiết kế + tiêu đề + biến của mẫu ở ngôn ngữ đã chọn. Trả 201 cùng DTO như tạo.
     Mẫu lạ -> 404 `NOT_FOUND` ("template preset … not found"); locale sai / thiếu tên -> 422; trùng
     tên -> 409 `TEMPLATE_NAME_TAKEN` (không tự đánh số).
   - **Tên bắt buộc**, như nhân bản (ADR-0033 §4): console gợi ý tên mẫu theo ngôn ngữ thư, người soạn
     sửa được; backend không tự đặt.
5. **Chép một lần, không nối**: template tạo ra là của app, sửa / xuất bản / lưu trữ như mọi template.
   Mẫu đổi `version` về sau KHÔNG đồng bộ sang — thư đang gửi không bao giờ đổi vì ai đó sửa mẫu.
6. **"Tạo từ mẫu" chỉ ghi trong audit**: `TemplateCreated` có `after.createdFromPreset =
   { presetId, presetVersion, locale }`. Không thêm cột `created_from_preset` (ADR-0033 §3 từng nêu):
   chưa màn nào cần lọc theo nó, audit đủ để truy ngược. `description` của template cũng chưa thêm —
   mô tả chỉ là của mẫu.

## 3. Hệ quả

- Màn Tạo template của console có bước chọn trước: "Bắt đầu từ trống" (luồng cũ) hoặc lưới thẻ mẫu lọc
  theo nhóm; bấm thẻ -> hộp xem trước (máy tính / điện thoại) + chọn ngôn ngữ thư + tên -> "Dùng mẫu".
- Thêm mẫu là thêm một hằng vào `TEMPLATE_PRESETS`; test tự kiểm nó.
- Sửa `renderDesign()` đổi luôn HTML của mẫu trên thư viện (sinh lúc gọi), nhưng không đổi template
  đã tạo từ mẫu — giống ADR-0034 §3.

## 4. Chưa làm

Ảnh trong mẫu (chờ chỗ lưu ảnh) · mẫu do tổ chức tự lưu ("lưu thành mẫu") · ngôn ngữ ngoài vi / en ·
đồng bộ / báo khi mẫu có version mới · cột `created_from_preset` / `description` trên `templates`.
