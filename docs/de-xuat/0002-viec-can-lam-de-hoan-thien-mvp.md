# ĐX-0002 — Việc cần làm để hoàn thiện bản MVP

- **Phát hiện**: 2026-09-20, khi rà lại toàn bộ workflow MVP sau lần gửi thư thật đầu tiên.
- **Trạng thái**: chờ duyệt — **chưa làm gì cả**.
- **Phạm vi**: cả hai kho `ews-astrolink-api` và `ews-astrolink`.

---

## 1. Phần máy chủ: đã xong, có bằng chứng

Chạy lại toàn bộ ngày 2026-09-20, không đọc suông:

| Kiểm | Kết quả |
| --- | --- |
| `npm run typecheck` | sạch |
| `npm test` (đơn vị + luật kiến trúc) | **181/181 xanh** |
| `npm run test:integration` (MySQL + Redis thật) | **121/121 xanh**, 121 giây |
| 5 dịch vụ Docker (`api`, `worker`, `scheduler`, `mysql`, `redis`) | đang chạy |

Đối chiếu `implementation_plan.md` mục 5: **10/10 đường dẫn bắt buộc đều có thật**, không
thiếu, không thừa ngoài nhóm cấp phát app.

Kịch bản nghiệm thu mục 11 — kể cả bước 6 (tắt chủ đề rồi gửi lại) mà làm tay chưa xong —
**máy đã tự kiểm, và kiểm kỹ hơn kịch bản**. Bảng tổ hợp trong
`test/integration/notifications-api.test.ts` phủ đủ 6 tình huống chặn thư: tắt chủ đề, chủ đề
phải tự bật, tắt hết tin không bắt buộc, địa chỉ hỏng, chưa có email, và **tắt ngay giữa lúc
thư đang xếp hàng** (dòng 195–197).

Tình huống cuối đáng ghi lại: người dùng bấm tắt **sau khi** thư đã vào hàng đợi thì thư vẫn
bị chặn. Quyền từ chối của nhân viên được tôn trọng tới phút chót — đúng chỗ mà hệ thống gửi
thư hay làm sai nhất.

**Kết luận: MVP theo kế hoạch đã xong ở phần máy chủ. Không tìm thấy lỗ hổng nghiệp vụ nào.**

---

## 2. Phần con người: chưa xong

### Sự thật về màn hình quản trị

26 màn hình. **3 màn có dữ liệu thật**: Danh sách app, Chủ đề, Khoá API.

**23 màn còn lại là hàng mẫu** — số liệu bịa sẵn trong `lib/mock-data.ts`: Thông báo, Người
dùng, Soạn thư, Mẫu thư, Đăng ký nhận tin, Hạn mức, Nhật ký, Duyệt app, Nhập người dùng,
Lịch gửi.

Chúng trông y như thật. Người dùng mở lên **không có cách nào biết** đó là số giả.

### Ba hệ quả cụ thể

**Một — không ai trả lời được câu "thư đó đã gửi chưa".**

Đã đụng phải thật: gửi thư qua Graph thành công, xem log thì trống trơn (xem `0001`). Cộng
thêm: máy chủ **không có đường dẫn quản trị nào** để tra cứu thông báo — chỉ có
`GET /v1/notifications/:id`, mà đường đó đòi **khoá API của chính app đó**.

Nên khi kế toán hỏi *"thư nhắc nợ hôm qua có tới không?"*:

- Màn Thông báo → số giả, không dùng được
- Nhật ký hệ thống → ~~không ghi gì~~ **đã có từ 2026-09-20** (`0001`): grep `email delivery finished` trong log worker
- Tra máy chủ → phải đi xin khoá API của đội kế toán, và phải biết trước mã thông báo

Sau `0001` thì **có một đường đi được**, nhưng là đường của người có quyền đọc log máy chủ. Người
trực không mở console lên tra được — phần đó vẫn nằm ở Việc 2.

**Hai — mở app mới phải làm bằng dòng lệnh.** Máy chủ có đủ lệnh tạo app và duyệt app. Màn
wizard `app/apps/new` có sẵn nhưng là hàng mẫu, không gọi thật. Mỗi đội mới xin tích hợp đều
phải gõ lệnh tay, và chỉ một người làm được.

**Ba — màn Hạn mức hiện `0/60` là con số vô nghĩa**: 60 không ai kiểm, 0 không ai đếm.

**Bốn — consent theo topic chặn đúng nhưng vô hình.** Phần gửi theo chủ đề tôn trọng lựa chọn
của nhân viên đã làm xong và làm đúng, nhưng không ai xem hay chứng minh được. Xem `0003` —
đó là lý do nghiệp vụ nặng nhất cho Việc 1 và Việc 2 dưới đây.

---

## 3. Bốn việc cần làm, xếp theo mức chặn

Nguyên tắc chọn thứ tự: **MVP xong không phải là "đủ tính năng", mà là "bàn giao được cho
người khác vận hành mà không cần hỏi lại".**

### Việc 1 — Gỡ hoặc khoá 23 màn hình giả *(chặn go-live)* — **ĐÃ LÀM 2026-09-20**

Không xoá code. Ba cách:

- **A. Ẩn khỏi menu** — sạch nhất, mất bản thiết kế đã dựng.
- **B. Đánh dấu "Bản xem trước — số liệu minh hoạ"** trên mỗi màn, dải băng không tắt được.
  Giữ giá trị demo, xoá nguy cơ hiểu nhầm. **Khuyên dùng.**
- **C. Để nguyên** — không khuyên. Màn quản trị hiện số giả mà không nói gì thì tệ hơn là
  không có màn đó.

Rẻ nhất trong bốn việc, gỡ được rủi ro lớn nhất.

**Đã làm theo cách B.** `lib/preview-routes.ts` giữ `WIRED_ROUTES` (3 route thật); `<PreviewBanner>`
render một lần trong `<AppShell>` và tự ẩn ở đó. Liệt kê theo chiều ngược nên **màn mới mặc định là
"chưa thật"** — quên cập nhật thì sai về phía an toàn. Dải băng không có nút tắt. Chi tiết:
`../../../ews-astrolink/CLAUDE.md` mục 2.4.

### Việc 2 — Trả lời được "thư đó ra sao" *(chặn vận hành)*

Hai phần, đi chung mới có tác dụng:

- **ĐX-0001**: ghi một dòng nhật ký mỗi lần gửi, đủ mọi kết cục (gửi được / bị chặn / hỏng),
  **không ghi địa chỉ và nội dung thư**.
- Thêm **một** đường tra cứu phía quản trị để màn Thông báo có số thật.

Phần sau **vượt ra ngoài mục 5 của kế hoạch** — tức là phải sửa kế hoạch. Đó là quyết định của
chủ dự án. Nhưng nói rõ: **không có nó thì hệ thống không vận hành được sau ngày đầu tiên.**

Nếu muốn giữ đúng kế hoạch thì riêng ĐX-0001 vẫn đỡ được phần nào — ít nhất còn chỗ mà tra.

### Việc 3 — Mở app mới bằng màn hình *(chặn bàn giao)* — **ĐÃ LÀM 2026-09-20**

Nối wizard "Tạo app" vào lệnh thật đã có. **Không cần thêm gì ở máy chủ.**

**Đã làm — nhưng không phải "chỉ nối dây" như ước lượng ban đầu.** Trình tự 4 bước khớp máy
trạng thái, nhưng các ô nhập thì không: bản v0 có `description`, `technical_contact`,
`severity`, `userMutable`, kênh riêng từng chủ đề và "quota đề xuất" ở bước 1 — backend không
có cột nào chứa. Đã bỏ hẳn những ô đó và viết lại form theo đúng body route.

Hai điểm đáng ghi:
* Kênh và hạn mức chuyển xuống **bước 4**, vì chúng là quyền cấp lúc duyệt.
* Chuỗi tạo app → allowlist → chủ đề → gửi duyệt **không chung transaction**; quy ước xử lý
  dừng giữa chừng ở `../../../ews-astrolink/CLAUDE.md` mục 2.5.

Còn lại: app đã tạo thì **không xoá được** (backend không có lệnh xoá, cố ý — giữ vết audit).
Tạm ngưng / thu hồi là Việc 4.

### Việc 4 — Công tắc ngắt app *(đang cân nhắc)* — còn lại

Tạm ngưng / Mở lại / Thu hồi ở `/admin/apps`, bắt buộc nhập lý do.

**Đứng sau việc 3**, không phải trước: mở app còn chưa làm được bằng màn hình thì ngắt app
chưa gấp. Kế hoạch **không đòi** cái này ở MVP.

Câu hỏi chưa có trả lời: *app đã bị ngắt thì trong ô chọn app nên làm mờ, hay đánh dấu?*

---

## 4. Cố ý để lại — không phải thiếu sót

| Việc | Vì sao hoãn |
| --- | --- |
| Hạn mức riêng từng app (429) | Mục 12, việc 5 |
| Xử lý thư trả về (bounce) | Mục 12, việc 1 |
| Mẫu thư | Mục 12, việc 2 |
| Trang tự huỷ đăng ký | Mục 12, việc 3 — **chỉ bắt buộc khi gửi ra ngoài công ty** |
| Đăng nhập + phân quyền admin | Mục 12, việc 4 — nay vẫn dùng một `ADMIN_TOKEN` chung |
| Gửi hàng loạt / nhóm người nhận | Mục 12, việc 6 |

Hai dòng cuối đáng để ý nếu định mở console cho nhiều người dùng chung.

---

## 5. Việc dọn dẹp nên làm ngay

`EMAIL_PROVIDER=graph` **vẫn đang bật** trong `.env`. Mỗi thông báo đi qua là một **lá thư
thật, không rút lại được**. Nên đổi về `mock` cho tới khi thực sự cần gửi thật.

*(File `.env` do chủ dự án tự sửa — chứa bí mật, và việc bật/tắt này gửi thư thật.)*

---

## 6. Không đề xuất làm gì ở đây

- Không đề xuất thêm hạn mức theo app — đã có chỗ trong mục 12.
- Không đề xuất xoá `lib/mock-data.ts` — còn dùng cho helper định dạng và kiểu dữ liệu hiển thị.
- Không đề xuất xoá bộ lọc segment đang tạm ngưng — đã chốt là **giữ**.
