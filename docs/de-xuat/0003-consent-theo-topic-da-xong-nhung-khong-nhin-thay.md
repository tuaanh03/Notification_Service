# ĐX-0003 — Consent theo topic: đã xong, nhưng không nhìn thấy được

- **Phát hiện**: 2026-09-20, khi rà lại việc "gửi theo topic / lựa chọn của người dùng" ở MVP.
- **Trạng thái**: chờ duyệt — **chưa làm gì cả**.
- **Quan hệ với `0002`**: không thêm việc mới vào 4 việc của ĐX-0002. Bổ sung **lý do nghiệp vụ**
  cho Việc 1 và Việc 2 ở đó, cộng **một đề xuất mới không cần code** (mục 5 dưới đây).

---

## 1. Kết luận trước: bộ máy đã đủ

Gửi theo chủ đề tôn trọng lựa chọn của nhân viên **đã làm xong, và là phần làm kỹ nhất của MVP**.
Không tìm thấy lỗ hổng nào.

Cổng kiểm: `src/modules/notifications/domain/rules/email-gate.ts`, chạy **trong worker, ngay
trước lúc gửi** — không phải lúc nhận yêu cầu. Chi tiết này quan trọng, nói ở mục 3.

Ba tầng chặn, xét theo thứ tự:

| Tầng | Câu hỏi | Người quyết |
| --- | --- | --- |
| **L0** | Địa chỉ này còn dùng được không? | Hệ thống (bounce) / nhân viên tự ngắt hẳn |
| **L1** | Người này có tắt *hết* tin không bắt buộc không? | Nhân viên |
| **L3** | Người này có tắt *riêng chủ đề này* không? | Nhân viên |

Luật L3 (`src/modules/topics/domain/rules/topic-consent.ts`) gọn trong ba dòng:

- Chủ đề **bắt buộc** -> luôn gửi, bỏ qua lựa chọn.
- Nhân viên **đã chọn** -> theo lựa chọn đó.
- Nhân viên **chưa chọn** -> theo mặc định của chủ đề (`opt_out` = mặc định bật,
  `opt_in` = mặc định tắt).

Ghi chú trong code nói đúng tinh thần nghiệp vụ:

> *Ý muốn của user (consent) luôn thắng ý muốn của hệ thống (targeting) — ngoại lệ duy nhất
> là topic mandatory.*

### Ranh giới của "bắt buộc" đặt đúng chỗ

Chủ đề bắt buộc (ví dụ: cảnh báo đăng nhập lạ) **vượt được L1 và L3, nhưng không bao giờ vượt
được L0**.

Thư bảo mật vẫn tới người đã tắt hết tin không bắt buộc — nhưng **không** tới địa chỉ đã hỏng
hoặc người đã tự ngắt hẳn email. Đây đúng là ranh giới nên có: "bắt buộc" không được biến
thành giấy phép gửi vào hộp thư chết.

Cả hai chiều đều có kiểm thử tích hợp riêng, chạy thật, xanh
(`test/integration/notifications-api.test.ts`, khối `gate L0 / L1 / L3`).

---

## 2. Nhân viên đổi lựa chọn bằng cách nào

Qua app, **không** qua console:

- `GET /v1/users/:externalId/preferences` — mọi chủ đề đang bật, kèm `effectiveOptIn` và `mandatory`
- `PUT /v1/users/:externalId/preferences` — `{ topics: { order_updates: false } }`, hoặc
  `{ optedOutOptional: true }` để tắt sạch tin không bắt buộc

Tắt chủ đề bắt buộc bị từ chối bằng `TOPIC_MANDATORY`. Không có đường lách.

**Đây là thiết kế cố ý**: app sở hữu quan hệ với nhân viên, nên màn "Cài đặt nhận thông báo"
thuộc về app đó. Xem thêm mục 5 — chính chỗ này sinh ra rủi ro.

---

## 3. Điểm mạnh đáng ghi nhận

Consent kiểm ở **lúc gửi**, không phải lúc nhận yêu cầu.

Tình huống thật: đội Đơn hàng bắn 500 thư lúc 9h00. Hàng đợi chạy tới 9h03. Một nhân viên bấm
tắt lúc 9h01. -> **Thư của người đó bị chặn.**

Có kiểm thử riêng cho đúng tình huống này: *"consent đổi SAU lúc xếp hàng, TRƯỚC lúc gửi ->
theo lựa chọn mới nhất"*.

Rất nhiều hệ thống gửi thư sai chỗ này — chốt danh sách người nhận lúc xếp hàng, rồi gửi cho
người vừa mới tắt. Ở đây làm đúng.

---

## 4. Vì sao vẫn dính vào ĐX-0002

Bộ máy không thiếu gì. Nhưng **không ai nhìn thấy nó làm việc** — và đó là chuyện hỗ trợ
người dùng, không phải chuyện kỹ thuật.

### Dính Việc 1 — màn "Đăng ký nhận tin" là hàng mẫu

Console có màn này nhưng là số giả. Hôm nay **không tra được** một nhân viên đang bật/tắt gì.

Nhân viên than *"sao tôi không nhận được thư đơn hàng?"* -> không có màn nào để nhìn. Phải đi
xin khoá API của đội Đơn hàng rồi gọi `GET /v1/users/:id/preferences` bằng tay.

### Dính Việc 2 — chặn đúng nhưng không chứng minh được

Chiều ngược lại: nhân viên than *"tôi tắt rồi mà vẫn nhận thư"*.

Hệ thống **đã chặn đúng** — nhưng không có bằng chứng nào đưa ra. Không log (`0001`), không
đường tra cứu quản trị (`0002` Việc 2).

Lý do chặn (`opted_out`, `opted_out_optional`, `suppressed`, `invalid`, `no_channel`) **được
ghi vào cơ sở dữ liệu đầy đủ** — chỉ là không ai đọc ra được.

Đây là điểm đáng tiếc nhất: **phần khó đã làm xong và làm đúng, nhưng vô hình.**

---

## 5. Đề xuất mới: coi "app có màn cài đặt chưa" là điều kiện duyệt app

Không phải lỗi hệ thống, nhưng nên chốt sớm.

**Hôm nay nhân viên chỉ tắt được thông báo nếu app tự dựng màn hình cho họ.** Hệ thống có sẵn
đường cho app gọi, nhưng nếu đội Đơn hàng không làm màn "Cài đặt nhận thông báo" thì nhân viên
**không có cách nào tự tắt**.

Trang tự phục vụ `/u/:token` (link "Quản lý thông báo" cuối thư) nằm ở `implementation_plan.md`
mục 12 việc 3, **chưa làm** — và kế hoạch ghi rõ nó **bắt buộc khi gửi ra ngoài công ty**.

Trong nội bộ thì chấp nhận được. Nhưng nghĩa là: **khi mở app cho đội nào, phải nói rõ với họ
rằng dựng màn cài đặt là trách nhiệm của họ.**

**Đề xuất**: đưa câu hỏi *"đội bạn đã có màn cài đặt nhận thông báo chưa?"* thành một bước bắt
buộc trước khi cấp khoá API. Rẻ, **không cần code** — nhưng phải có người nhớ, nếu không thì
cái cổng consent làm kỹ ở mục 1 sẽ không ai dùng tới.

Nếu sau này mở ra ngoài công ty thì bước hỏi này không đủ, phải làm mục 12 việc 3.

---

## 6. Không đề xuất làm gì ở đây

- **Không** đề xuất sửa `email-gate.ts` hay `topic-consent.ts` — hai file đó đã đúng.
- **Không** đề xuất cho admin sửa lựa chọn của nhân viên thay họ. Consent là ý muốn của người
  dùng; admin sửa hộ thì mất hết ý nghĩa. Admin chỉ cần **xem** (Việc 1 của `0002`).
- **Không** đề xuất làm sớm `/u/:token` — chỉ bắt buộc khi gửi ra ngoài công ty.
