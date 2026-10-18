# ADR-0033 — Template: nhóm cố định, tìm theo tên, nhân bản; thư viện mẫu để sau

**Trạng thái:** chấp nhận — 2026-10-18 (đợt 1: nhóm, tìm, nhân bản). Mở rộng ADR-0020.

## 1. Bối cảnh

Người dùng tham khảo màn Templates của OneSignal: mẫu dựng sẵn theo chủ đề, gom theo nhóm, trình soạn
kéo-thả. Màn Templates của mình chỉ có tên + trạng thái, không gom, không tìm, không chép được một
template sang template mới. Đợt 1 làm phần quản lý; thư viện mẫu là đợt 3, kéo-thả là đợt 2 (ADR riêng).

## 2. Quyết định

1. **Nhóm là bộ cố định**, cột `templates.category` (ENUM, mặc định `other`, migration 0024):
   `alert` · `system` · `onboarding` · `reminder` · `approval` · `report` · `other`. Khai bằng mảng
   `TEMPLATE_CATEGORIES` trong `shared/kernel/enums.ts`, console sao lại ở `lib/template-categories.ts`.
   Một template một nhóm. Chỉ để admin gom và lọc — **không ảnh hưởng việc gửi**, `/v1` không thấy.
   Không cho app tự đặt nhóm, không nhãn tự do: chưa có nhu cầu, và bộ cố định dịch được vi / en.
2. **Đổi nhóm đi chung `PATCH …/templates/:id`** với đổi tên (`UpdateTemplate`, thay `RenameTemplate`):
   cùng khoá dòng `templates`, cùng một transaction. Mỗi thứ thật sự đổi ghi một event riêng
   (`TemplateRenamed`, `TemplateCategoryChanged`, `before` / `after`); không đổi gì thì không ghi.
   Body rỗng -> 422. Đã lưu trữ -> `TEMPLATE_ARCHIVED`, như đổi tên.
3. **Tìm theo tên ở backend**: `GET …/templates?category=&q=`. `q` khớp một phần bằng `LIKE`, `%` / `_`
   được thoát nên là chữ thường. Collation `utf8mb4_0900_ai_ci` làm "canh bao" tìm ra "Cảnh báo" — cùng
   luật với tên trùng (ADR-0020 §3.2), nên tìm và báo trùng không lệch nhau. Không phân trang: một app
   có ít template.
4. **Nhân bản trong cùng app**: `POST …/templates/:id/duplicate` (`app.manage`, như tạo), body
   `{ name }` (bắt buộc). Ra template MỚI (id mới), cùng nhóm, chỉ có nháp v1 chép nội dung + biến từ bản mới nhất
   của bản gốc — **nháp nếu có, không thì bản đang xuất bản**. Chép một lần, hai template không nối với
   nhau; bản sao chưa gửi được cho tới khi xuất bản (ADR-0020 §2).
   - **Tên bắt buộc, backend không tự đặt.** Hậu tố "(bản sao)" / "(copy)" theo ngôn ngữ người soạn —
     console biết ngôn ngữ, backend thì không; đặt mặc định ở backend là tên tiếng Việt lọt vào màn
     tiếng Anh. Console gợi ý sẵn `<tên gốc> (bản sao)` / `(copy)` trong hộp, người soạn sửa được.
     Thiếu / rỗng -> 422. Trùng tên -> 409 `TEMPLATE_NAME_TAKEN`, không tự đánh số.
   - Khoá dòng bản gốc trước khi đọc version (ADR-0009): đang có người lưu nháp thì chờ họ xong.
   - Bản gốc đã lưu trữ vẫn nhân bản được. Bản gốc giữ `archived`; đây KHÔNG phải đường bỏ lưu trữ —
     app nào đang gửi bằng id cũ vẫn bị `TEMPLATE_ARCHIVED`.
   - Audit: `TemplateCreated` với `after.duplicatedFrom = { templateId, version }`.

## 3. Đợt 3 — thư viện mẫu (CHƯA LÀM)

Hướng đã đề xuất, chờ người dùng chốt: mẫu hệ thống viết trong code backend (vi / en), chỉ đọc, gắn
một nhóm của quyết định 1; "Dùng mẫu này" chép thành template mới của app như nhân bản — không đồng bộ khi
mẫu đổi. Mẫu phải qua `validate()` với 0 lỗi (không chữ "unsubscribe", link https / mailto / biến).
Cột `created_from_preset`, `description` thêm khi làm đợt này, không thêm trước.

## 4. Chưa làm

Thư viện mẫu (mục 3) · nhóm do app tự đặt / nhãn tự do · chép template sang app khác · trình soạn
kéo-thả (đợt 2, ADR riêng: cột `editor` / `design`).
