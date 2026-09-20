# ĐX-0004 — Bề mặt đọc cho vận hành, phạm vi theo app

- **Phát hiện**: 2026-09-20, khi rà lại câu hỏi "ai đang bật topic nào" và mô hình để đội app
  tự vào console xử lý nhân viên của họ.
- **Trạng thái**: phần 1 và 2 **đã làm 2026-09-20**; phần 3 (trang giao đội app) còn lại.
- **Phạm vi**: cần sửa `implementation_plan.md` mục 5. Đó là lý do file này tồn tại.

---

## 0. Tóm tắt

`/admin/*` hiện gần như **chỉ có ghi**: tạo app, duyệt app, tạo topic, cấp khoá. Nó **không có
đường nào đọc dữ liệu vận hành** — không tra được người nhận, không tra được lần gửi.

Hệ quả: hai câu hỏi hỗ trợ thường gặp nhất đều không trả lời được từ console.

| Câu hỏi của người dùng | Cần gì |
| --- | --- |
| *"Sao anh A không nhận được thư?"* | màn Người nhận — **phần 2 của đề xuất này** |
| *"Thư gửi cho anh A hôm qua đi chưa?"* | lịch sử gửi — `0002` Việc 2, làm sau |

Câu thứ nhất thực tế hơn: nó **không đòi biết trước mã thông báo**, người trực chỉ có trong tay
một cái tên. Và phần lớn trường hợp câu trả lời nằm đúng ở đó — *anh ấy tắt topic rồi*, hoặc
*email anh ấy đã chết*.

Đề xuất này gồm ba phần:

1. **Bản sửa kế hoạch** — mở một nhóm "bề mặt đọc cho vận hành", chốt nguyên tắc đường dẫn.
2. **Màn Người nhận** — cần thêm gì, dùng lại được gì.
3. **Một trang giao cho đội app** — 5 bước tích hợp và hai chính sách họ phải tự giữ.

---

## 1. Bản sửa `implementation_plan.md` mục 5

### Vì sao phải sửa kế hoạch

Mục 5 liệt kê **toàn bộ** bề mặt API của MVP. Ba đường `/admin` duy nhất đều thuộc topic. Không
có đường nào cho người nhận, cũng không có cho thông báo. Thêm vào là **đổi phạm vi MVP**, nên
phải sửa kế hoạch chứ không lặng lẽ thêm route.

### Đề nghị sửa một lần, không sửa ba lần

Thay vì mỗi màn lại mở kế hoạch ra thêm một dòng, mở **một nhóm** và ghi nguyên tắc chung:

> **Bề mặt đọc cho vận hành (`/admin`, chỉ đọc).**
> Mọi đường đọc dữ liệu vận hành đặt dưới `/admin/apps/:appId/*` — phạm vi theo app nằm trên
> URL, không phải tham số truy vấn, không phải suy ra từ token.

Rồi lần lượt cắm ba màn vào nhóm đó: **Người nhận** -> **Đăng ký nhận tin** -> **Lịch sử gửi**.

### Nguyên tắc đường dẫn — quyết định quan trọng nhất của đề xuất này

Đặt `/admin/apps/:appId/users`, **không** đặt `/admin/users`.

Lý do không phải thẩm mỹ. Bảng `admin_app_roles` **đã tồn tại** trong schema:

```
admin_id · app_id · role: super_admin | app_admin · granted_at · revoked_at · account_id
```

Có `app_id` -> thiết kế sẵn cho việc phân quyền **theo từng app**, kèm composite FK chống cấp
quyền chéo account (ADR-0011). Nhưng **0 dòng, và không code nào dùng** — xác thực `/admin/*`
hiện là `BootstrapAdminAuthenticator`, **một token duy nhất toàn quyền** (ADR-0015 §4).

Khi đăng nhập + RBAC được làm (`implementation_plan.md` mục 12 việc 4), vai `app_admin` chỉ cần
thêm **một lớp kiểm** "admin này có quyền trên app này không". `appId` đã nằm sẵn trên URL nên
lớp đó cắm vào được ngay.

Đặt sai bây giờ thì lúc đó phải sửa cả bề mặt API lẫn console. Đây là chỗ rẻ nhất để làm đúng.

Mẫu đã có sẵn và đang chạy: `/admin/apps/:appId/topics`.

---

## 2. Màn Người nhận + Đăng ký nhận tin

### Chỉ đọc — đã chốt

**Console KHÔNG cho admin bật/tắt topic hộ nhân viên.** Consent là ý muốn của người dùng; sửa
hộ là mất hết ý nghĩa của cả cổng L0/L1/L3 (`0003` mục 6). Admin chỉ cần **xem**.

Đội app đã có đủ đường ghi bằng khoá API của chính họ (`PUT /v1/users/:id/preferences`,
`DELETE /v1/users/:id/email`) — họ **không cần** nút trong console để thực thi chính sách.

Thứ họ thiếu, và thứ người vận hành thiếu, là **quyền nhìn**.

### Phần lõi đã có sẵn — nhiều hơn dự kiến

Ba use case cần cho màn chi tiết đều đã tồn tại và đang chạy:

| Use case | Module | Trả về |
| --- | --- | --- |
| `FindUserByExternalId` | directory | `UserDto` (userId, externalId, createdAt, email) |
| `FindUserEmail` | subscriptions | `EmailSubscriptionDto` (địa chỉ, status, suppressedReason, optedOutOptional) |
| `GetUserPreferences` | topics | `UserPreferencesDto` |

`UserPreferencesDto` **đã đúng hình dạng màn chi tiết**, không phải dựng mới:

```
externalId
email        -> null = chưa có email
topics[]     -> key · name · mandatory · defaultMode
                optedIn       (null = CHƯA CHỌN, đang theo defaultMode)
                effectiveOptIn (kết quả lớp L3)
```

Hai field `optedIn` và `effectiveOptIn` tách nhau là thứ đáng hiện **cả hai** trên màn: một cái
trả lời *"người này đã bấm gì"*, cái kia trả lời *"rốt cuộc có nhận không"*.

Lưu ý phải ghi rõ trên giao diện: `effectiveOptIn` **chỉ là lớp L3**. Email chết (L0) hoặc tắt
hết tin không bắt buộc (L1) vẫn chặn thư dù `effectiveOptIn = true`. Hai lớp đó nằm ở khối
`email` của cùng DTO — hiện cạnh nhau thì người trực mới đọc đúng.

### Thiếu đúng hai thứ

**Một — truy vấn danh sách.** Hiện chỉ tra được người **đã biết `external_id`**. Không có
query nào liệt kê. Cần thêm một query ở `directory/application/queries/`, có phân trang và tìm
theo `external_id`. Đây là phần viết mới thật sự.

**Hai — hai đường `/admin`:**

| Route | Việc |
| --- | --- |
| `GET /admin/apps/:appId/users` | danh sách người nhận của app, phân trang, tìm theo `external_id` |
| `GET /admin/apps/:appId/users/:externalId` | chi tiết: email + tình trạng + lựa chọn từng topic |

Đường thứ hai gần như chỉ là lớp `interface/http` gọi ba use case đã có.

### Console

`app/users/` và `app/subscriptions/` **đã có màn**, đang là hàng mẫu (`<PreviewBanner>` đang dán
nhãn). Đấu nối theo mẫu `/topics`: Server Action, vì app đang chọn nằm trong state client của
`<AppProvider>`. Đấu xong thì **thêm route vào `WIRED_ROUTES`**
(`ews-astrolink/lib/preview-routes.ts`) — dải băng "Bản xem trước" tự tắt.

### Vì sao làm trước `0002` Việc 2

* Trả lời được câu hỏi hỗ trợ **thường gặp hơn**, và không đòi biết trước mã thông báo.
* Phần lõi đã có; Việc 2 phải viết query lịch sử từ đầu.
* Cùng phải sửa kế hoạch, nên làm cái giá trị cao trước.

---

## 3. Trang giao cho đội app

Phần này **không cần code**. Nó tồn tại vì hiểu nhầm ở đây chỉ lộ ra lúc đã viết xong tích hợp.

### Mô hình phải nói rõ ngay từ đầu

> **EWS không giữ danh sách người nhận. Đội app giữ.**

EWS nhận **một lá thư cho một người** mỗi lời gọi. Topic không phải danh sách người nhận — nó là
câu hỏi *"người này có đồng ý nhận loại tin này không"*. Gửi cho 200 người là **app lặp 200 lần**.

Gửi hàng loạt theo phân khúc nằm ở mục 12 việc 6, chưa có.

### Năm bước tích hợp

| # | Việc | Ai làm |
| --- | --- | --- |
| 1 | Tạo app, duyệt, cấp khoá API | **EWS** — màn Danh sách app |
| 2 | Tạo topic **và kích hoạt** | **EWS** — màn Chủ đề |
| 3 | Khai báo nhân viên + email (`PUT /v1/users/:externalId`) | **đội app** |
| 4 | Dựng màn "Cài đặt nhận thông báo" cho nhân viên | **đội app** |
| 5 | Gọi gửi, mỗi người một lời gọi, **kèm `idempotencyKey`** | **đội app** |

Bước 2: topic mới tạo ở trạng thái `draft`, chưa kích hoạt thì gọi gửi trả `TOPIC_NOT_ACTIVE`.

Bước 3 hay bị bỏ sót nhất: EWS **không biết nhân viên nào tồn tại** cho tới khi app khai. Chưa
khai mà gửi -> `RECIPIENT_NOT_FOUND`.

Bước 4 là thứ ô tick lúc duyệt app đang hỏi (`0003` mục 5). Không có màn đó thì nhân viên
**vĩnh viễn không tắt được gì** — và cổng consent làm rất kỹ trở nên vô dụng.

Bước 5: thiếu `idempotencyKey` thì một lần thử lại là một lá thư trùng vào hộp thư người nhận.

### Hai chính sách đội app phải tự giữ

Đây là quyết định của đội app, EWS không ép được — nhưng phải nói trước.

**Không tái dùng `external_id`.** Ràng buộc là `UNIQUE (app_id, external_id)`. Cấp lại mã của
người đã nghỉ cho người mới thì người mới **thừa kế nguyên** lựa chọn của người cũ: người cũ tự
ngắt email thì người mới vẫn bị ngắt, người cũ tắt topic thì người mới vẫn tắt. Không lỗi, không
cảnh báo — chỉ là thư không tới.

**Nhân viên nghỉ việc thì gọi `DELETE /v1/users/:externalId/email`.** EWS không nối vào hệ thống
nhân sự, không tự biết ai đã nghỉ. Không gọi thì EWS vẫn giữ địa chỉ và vẫn gửi. Cộng thêm việc
**xử lý thư dội về chưa làm** (mục 12 việc 1), thư sẽ gửi mãi vào hộp thư đã đóng — và uy tín
hộp thư gửi của công ty đi xuống.

### Lỗi thường gặp và nghĩa của nó

| Mã lỗi | Nghĩa |
| --- | --- |
| `RECIPIENT_NOT_FOUND` | chưa khai nhân viên — làm bước 3 |
| `TOPIC_NOT_ACTIVE` | topic còn `draft`, chưa kích hoạt |
| `TOPIC_NOT_FOUND` | sai `key`, hoặc topic của app khác |
| `CHANNEL_NOT_GRANTED` | app chưa được cấp kênh email lúc duyệt |
| `TOPIC_MANDATORY` | đang cố tắt một topic bắt buộc — không có đường lách |

Gửi thành công trả **202**, nghĩa là **đã nhận, CHƯA gửi**. Theo dõi bằng
`GET /v1/notifications/:id`.

---

## 4. Thứ tự đề nghị

1. **Sửa kế hoạch** — mở nhóm bề mặt đọc, chốt nguyên tắc `/admin/apps/:appId/*`.
2. **Màn Người nhận + Đăng ký nhận tin** (chỉ đọc).
3. **Trang giao đội app** — tách ra `docs/` riêng khi phần 1 và 2 xong, để số liệu trong đó khớp
   thực tế.
4. **Đăng nhập + phân quyền `app_admin`** (mục 12 việc 4) — thứ hiện thực hoá mô hình "đội app
   tự vào xem app của mình". Làm sau bề mặt đọc: lúc có đăng nhập thì đã có sẵn màn để cho xem.
5. **Lịch sử gửi** (`0002` Việc 2) — cắm vào cùng nhóm, cùng dạng đường dẫn.

---

## 5. Không nằm trong phạm vi đề xuất này

* **Không** cho admin sửa lựa chọn topic của nhân viên — xem phần 2.
* **Không** thêm nút xoá email / ngắt luồng gửi trong console: đội app đã có đường qua `/v1`.
* **Không** làm gửi hàng loạt theo phân khúc (mục 12 việc 6).
* **Không** làm đăng nhập trong đợt này — chỉ chốt trước dạng đường dẫn để sau cắm vào được.
* **Không** đụng vào `resolution-pipeline.ts`: đã viết xong, chưa ai gọi, giữ nguyên cho mục 12.6.

---

## 6. Kết quả phần 1 và 2 (2026-09-20 — ĐÃ LÀM)

**Kế hoạch:** `implementation_plan.md` §5 có thêm nhóm *"Bề mặt đọc cho vận hành (`/admin`, CHỈ
ĐỌC)"*, kèm nguyên tắc `/admin/apps/:appId/*` và lý do gắn với `admin_app_roles`.

**Máy chủ:** hai đường mới, đúng như đề xuất. Điểm đáng ghi:

* `ListUsers` lấy email theo **LÔ** (`emails.findMany` -> `FindUserEmail.executeMany` ->
  `SubscriptionRepository.findManyByUsers`). Bản đầu định gọi `find` từng người: 200 người nhận là
  201 truy vấn. Cross-module vẫn đúng luật — directory gọi use case công khai của subscriptions,
  không join sang bảng `subscriptions`.
* Đường preferences **dùng nguyên `GetUserPreferences`**, không viết thêm gì. Path nằm dưới
  `/users` nhưng thuộc module topics — cùng lý do với `/v1/users/:id/preferences`.

**Console:** `/users` đấu thật. Ba điều chỉnh so với hình dung ban đầu:

1. **Địa chỉ email không có trong response preferences.** `UserEmailSummary` của backend cố tình
   chỉ mang `status` + `optedOutOptional`. Đã **không nới DTO** — địa chỉ lấy từ dòng trong danh
   sách. Nới một DTO dùng chung chỉ để tiện cho một màn là cách bắt đầu của mọi lần phình.
2. **`WIRED_ROUTES` phải tách làm hai.** `/users` đấu rồi nhưng `/users/[id]` và `/users/import`
   thì chưa; khớp theo tiền tố sẽ gỡ nhãn "Bản xem trước" khỏi hai màn vẫn là hàng mẫu. Thêm
   `WIRED_EXACT_ROUTES` cho trường hợp "chỉ chính nó".
3. **Hai ô tìm kiếm cạnh nhau.** `<DataTable>` luôn dựng ô lọc riêng, lọc **trang đang hiển thị**;
   cạnh ô tìm phía máy chủ thì hai ô trông giống nhau mà ra kết quả khác nhau. Thêm prop
   `hideSearch`.

**Kiểm chứng:** 4 test tích hợp mới (`users-api.test.ts`) — phạm vi theo app không lẫn sang nhau,
người chưa khai email vẫn hiện, tìm + phân trang, 404. Trên trình duyệt: `emp_01` của EWS
Hypervisor hiện đúng hai ca cạnh nhau — `order_updates` "tắt / không" và `maintenance_notice`
"chưa chọn / có".

**Còn lại:** phần 3 (trang giao đội app) và các mục ở phần 4 — RBAC, rồi lịch sử gửi.
