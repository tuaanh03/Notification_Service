# ADR-0019 — Đăng nhập admin bằng phiên, bỏ `ADMIN_TOKEN`

**Trạng thái:** chấp nhận — 2026-09-23. **Thay thế §4 của ADR-0015.**

## 1. Bối cảnh

ADR-0015 §4 dựng `BootstrapAdminAuthenticator`: MỘT token trong env `ADMIN_TOKEN` mở toàn bộ
`/admin/*`, actor audit là `bootstrap-admin`, và ghi rõ "thay bằng session + RBAC trước khi mở cho
người ngoài". Hệ thống nay chuẩn bị chạy thật nên đến hạn của lời hẹn đó.

Bốn điểm hỏng của token dùng chung, xếp theo mức nghiêm trọng:

- **Không biết ai làm gì.** Mười người dùng chung token thì `audit_log` ghi y hệt như một người.
- **Không thu hồi riêng được.** Cắt quyền một người = đổi token + khởi động lại = cắt quyền cả mười.
- **Không hết hạn.** Token rò ra là rò vĩnh viễn, không có mốc nào tự đóng lại.
- **Không phân quyền được.** `admin_app_roles` có sẵn vai `super_admin` / `app_admin` (ADR-0011)
  nhưng một token dùng chung không gắn vào vai nào.

## 2. Phiên MỜ lưu trong DB, không phải JWT access + refresh

Đăng nhập đúng -> sinh chuỗi ngẫu nhiên 256 bit, lưu `sha256` vào `admin_sessions`, trả bản gốc
đúng một lần. Mỗi request `/admin/*` tra băm đó. **Đăng xuất = xoá dòng**, mất quyền ngay.

Cặp access/refresh bị loại vì nó giải một bài toán khác: access token tự chứa (JWT) không thu hồi
được nếu không tra DB, nên phải sống ngắn và có refresh cấp lại. Mà yêu cầu ở đây CHÍNH LÀ thu
hồi được — tức là phải tra DB mỗi request — nên toàn bộ lợi ích của JWT biến mất, chỉ còn lại độ
phức tạp: hai loại token, hai hạn dùng, luồng cấp lại, đua giữa nhiều tab, chống dùng lại refresh.

Console cũng không phải SPA: browser không gọi backend, Next.js gọi thay ở phía server. Không có
client phân tán nào cần token tự chứa.

**Hạn 12 tiếng, tuyệt đối, không gia hạn trượt.** Đặt cứng trong `tenancy.module.ts`, không qua env:
đây là quyết định bảo mật, không phải thứ mỗi môi trường tự chỉnh.

## 3. Hai cách băm khác nhau, có lý do

| Thứ | Băm bằng | Vì sao |
| --- | --- | --- |
| Mật khẩu | scrypt (N=2^15, salt) | Người đặt -> entropy thấp -> phải băm CHẬM |
| Token phiên | SHA-256 | 256 bit ngẫu nhiên -> không dò được; băm chậm sẽ tốn ~100 ms MỖI request |

Cùng lý lẽ đã dùng cho API key ở ADR-0015 §3, áp cho hai đầu ngược nhau.

**scrypt chứ không argon2**: argon2 là package native, phải biên dịch hoặc tải prebuild lúc cài —
thêm một đường hỏng vào bản dựng Docker. scrypt có sẵn trong `node:crypto`, cùng họ "chậm + tốn bộ
nhớ". Băm mang sẵn tham số trong chuỗi (`scrypt$N$r$p$salt$key`) nên đổi tham số sau này vẫn kiểm
được băm cũ, và đổi hẳn thuật toán chỉ là thay adapter của port `PasswordHasher`.

`LoginAdmin` luôn băm một lần kể cả khi email không tồn tại (`DUMMY_PASSWORD`), nếu không thì email
lạ trả lời nhanh hơn email thật và người ngoài dò ra được ai là admin bằng thời gian phản hồi.

## 4. Admin đầu tiên tạo bằng CLI, KHÔNG qua HTTP

Bỏ `ADMIN_TOKEN` thì lộ ra vòng tròn: tạo admin cần quyền admin. Phải có một lối vào từ ngoài HTTP.

`src/entrypoints/admin-cli` chạy trong container và nói thẳng với database:
`create-admin`, `reset-password`, `list-accounts`. Mật khẩu luôn đọc qua stdin, không nhận từ tham
số dòng lệnh (tham số nằm lại trong lịch sử shell và trong `ps`).

Cách này **hẹp hơn** `ADMIN_TOKEN`: ai chạy được CLI thì đã có quyền trên máy chủ rồi, còn token
thì mở một cửa vào `/admin/*` **qua mạng** cho bất kỳ ai có chuỗi đó. `reset-password` cũng thay
luôn vai trò "khoá dự phòng" mà token từng gánh — và nó huỷ mọi phiên đang mở của admin đó, vì đổi
mật khẩu mà kẻ chiếm phiên vẫn ở trong hệ thống thì việc đổi chẳng cứu được gì.

## 5. `/auth/*` nằm ở bề mặt PUBLIC, không dưới `/admin`

`/auth/login`, `/auth/logout`, `/auth/me` là cửa để LẤY phiên nên không thể đòi phiên trước. Đặt
chúng dưới `/admin` — nơi mọi thứ đều nằm sau hook xác thực (ADR-0015 §2) — sẽ tạo một ngoại lệ
nằm lẫn giữa các route có bảo vệ, thứ người đọc sau sẽ hiểu nhầm.

Route `/admin/*` hiện có **không sửa một dòng nào**: chỉ thay hiện thực `AdminAuthenticator`, đúng
như ADR-0015 §4 đã hẹn. Cookie do console đặt; backend chỉ biết `Authorization: Bearer`.

## 6. Migration CHỈ THÊM

`ALTER TABLE admins ADD password_hash` (cho phép NULL) + `CREATE TABLE admin_sessions`. Không sửa,
không xoá cột nào. Nhờ vậy **lùi image về bản cũ không cần lùi database**: mã cũ không biết cột mới
tồn tại và chạy bình thường trên schema mới. `password_hash` NULL = chưa đặt mật khẩu = không đăng
nhập được, khác hẳn "mật khẩu rỗng".

## 7. Cái giá đã chấp nhận

- **Console tắt vài phút giữa hai lần deploy.** Không giữ `ADMIN_TOKEN` chạy song song nghĩa là api
  mới không nhận token cũ, mà console cũ chưa biết đăng nhập. Chọn vậy vì lúc chuyển đổi chưa có
  người dùng thật và chưa có thư thật nào đi. **Về sau không còn rẻ như vậy**: mọi thay đổi cắt đứt
  giao thức giữa api và console sẽ phải có giai đoạn chấp nhận cả cũ lẫn mới.
- **Chưa có RBAC.** Mọi admin vẫn toàn quyền; `admin_app_roles` chưa được đọc. Nhưng từ nay
  `AdminCaller.adminId` là người thật, nên thêm lớp kiểm quyền chỉ là thêm, không phải sửa lại.
- **Chưa giới hạn số lần đăng nhập sai.** Cắt khỏi phạm vi có chủ đích. Rủi ro hiện thấp vì cổng chỉ
  mở trên card WireGuard; thành cần thiết ngay khi console mở rộng hơn.
- **Chưa có "đăng xuất mọi thiết bị" trên giao diện.** `reset-password` làm được việc đó qua CLI.
