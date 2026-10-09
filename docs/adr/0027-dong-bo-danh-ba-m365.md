# ADR-0027 — Đồng bộ danh bạ M365 thành tài khoản EWS, chọn người từ danh sách khi thêm thành viên

**Trạng thái:** chấp nhận — 2026-10-09.

## Bối cảnh

Thêm thành viên (ADR-0026) đòi người đó đã có tài khoản, tức đã đăng nhập M365 một lần (ADR-0024).
Người quản lý org phải nhắc đồng nghiệp đăng nhập trước, rồi gõ đúng email. App `GRAPH_*` (đang dùng
gửi mail, ADR-0018) đã có quyền application `User.Read.All` / `Directory.Read.All` — kiểm ngày
2026-10-09 bằng token client credentials: `GET /users` trả 200.

## Quyết định

1. **Đồng bộ do Super Admin bấm** — `POST /admin/directory/m365-sync`, quyền `platform.manage`. Không
   có lịch chạy tự động, không có lệnh CLI. Người mới vào công ty: tự đăng nhập M365 (ADR-0024) hoặc
   chờ lượt đồng bộ sau.
2. **Đọc bằng app `GRAPH_*`, không phải app đăng nhập `M365_*`** — app đăng nhập chỉ có scope
   delegated `openid profile email` (ADR-0021). Port `TenantDirectory`, hiện thực `GraphTenantDirectory`
   (`/users`, `$top=999`, đi theo `@odata.nextLink`). Lọc ở EWS: chỉ tài khoản đang bật, không phải
   khách mời (`Guest` / UPN có `#EXT#`), có email (`mail`, thiếu thì UPN).
3. **Cùng luật khớp với lần đăng nhập M365 đầu (ADR-0024)**: đã gắn `oid` -> chỉ cập nhật tên; có
   email chưa gắn -> gắn `oid`; chưa có -> tạo vai `user`, không mật khẩu, account cũ nhất, gắn sẵn
   `oid`; email đã gắn `oid` khác -> bỏ qua (đếm `conflicts`). Mỗi người một transaction; chạy chồng
   với lần đăng nhập đầu hay lượt đồng bộ khác thì khoá duy nhất quyết (`insertIfAbsent`,
   `linkMicrosoft` có điều kiện), lần thua đọc lại theo `oid`. Chạy lại bao nhiêu lần cũng được.
4. **Hai tenant phải trùng.** `oid` chỉ có nghĩa trong một tenant. `GRAPH_TENANT_ID` khác
   `M365_TENANT_ID` -> danh bạ tắt, 503 `M365_DIRECTORY_TENANT_MISMATCH` (không thì tạo ra tài khoản
   không ai đăng nhập vào được). Thiếu `GRAPH_*` -> 503 `M365_DIRECTORY_NOT_CONFIGURED`. Graph lỗi ->
   502 `M365_DIRECTORY_ERROR`. Không thêm biến môi trường.
5. **Cột mới `admins.display_name`** (migration `0009`, nullable, chỉ để hiển thị — không định danh).
   Điền lúc đồng bộ và mỗi lần đăng nhập M365 (claim `name`). M365 không trả tên thì giữ tên cũ.
   Đổi tên không audit.
6. **Danh sách để chọn** — `GET /admin/organizations/:orgId/member-candidates`, quyền `org.manage`:
   mọi tài khoản cùng account với org, trừ người đã là thành viên; mỗi dòng chỉ `adminId`, `email`,
   `displayName`. Thêm vẫn qua `PUT …/members` (không đổi). `OrgMemberDto` có thêm `displayName`.
7. Audit: mỗi tài khoản tạo / gắn có `AdminCreated` / `AdminMicrosoftLinked` (`via: m365_directory_sync`);
   cả lượt một dòng `TenantDirectorySynced` (ai bấm + các con số). Route trả CHỈ con số
   (`total`, `created`, `linked`, `renamed`, `unchanged`, `conflicts`), không trả danh sách email.

## Không làm

Không khoá / xoá tài khoản khi người đó rời tenant. Không đồng bộ nhóm. Không đổi email của tài khoản
đã gắn `oid` khi email trên M365 đổi (giống đăng nhập). Không mời qua email.

## Hệ quả

`ADMIN_NOT_REGISTERED` vẫn còn cho email gõ tay chưa có tài khoản. App `GRAPH_*` giờ dùng cho hai việc
(gửi mail, đọc danh bạ) — thu hồi `User.Read.All` của app đó là nút đồng bộ báo `M365_DIRECTORY_ERROR`.
