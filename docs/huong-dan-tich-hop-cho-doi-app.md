# Hướng dẫn tích hợp EWS gửi email — cho đội app

*Tách từ ĐX-0004 phần 3 (2026-09-21). Áp dụng cho **MVP**: chỉ email, gửi từng người.*

Tài liệu này dành cho đội phát triển của một app muốn gửi email thông báo cho nhân viên qua EWS.
Mọi route, body, mã lỗi ở đây sao đúng mã nguồn; mỗi mục ghi test nào chứng minh nó. Thấy chỗ nào
lệch với hành vi thật thì báo đội EWS — tài liệu sai, không phải bạn sai.

---

## 1. Hiểu đúng mô hình trước khi viết dòng code nào

> **EWS không giữ danh sách người nhận. Đội app giữ.**

* **Mỗi lời gọi gửi là một lá thư cho một người.** Gửi cho 200 người là app **lặp 200 lần**.
* **Chủ đề (topic) không phải danh sách người nhận.** Nó là câu hỏi *"người này có đồng ý nhận
  loại tin này không"*. EWS dùng nó để **chặn** thư người nhận đã từ chối — không dùng nó để tìm
  ra người nhận.
* **App quyết định gửi cho ai. EWS quyết định có được phép gửi không.** Lời gọi gửi hợp lệ vẫn có
  thể kết thúc bằng "không gửi" vì nhân viên đã tắt chủ đề đó. Đây là hệ thống làm đúng, không
  phải lỗi.
* **Kiểm quyền nhận lúc gửi, không phải lúc gọi.** Nhân viên tắt chủ đề sau khi app gọi nhưng
  trước khi thư đi thì thư không đi.

Gửi hàng loạt theo phân khúc, template, hẹn giờ: **chưa có** (xem mục 9).

---

## 2. EWS đưa cho bạn những gì

| Thứ | Ghi chú |
| --- | --- |
| **Địa chỉ API** | Đội EWS cung cấp. Dưới đây viết là `$EWS`. Mọi đường dẫn bắt đầu bằng `/v1`. |
| **Khoá API** | Dạng `ews_<32 hex>_<43 ký tự>`. **Chỉ hiện một lần** lúc cấp — mất là phải cấp khoá mới. |
| **Danh sách chủ đề** | Đội EWS tạo và kích hoạt. App không tạo được chủ đề. Đọc lại bằng `GET /v1/topics`. |

**Khoá API:**

* Gửi thẳng: `Authorization: Bearer <khoá>`. **Không có bước đổi khoá lấy token.**
* Một app có **tối đa 2 khoá đang dùng**. Cấp khoá mới **không** thu hồi khoá cũ — đúng để bạn
  xoay khoá không mất kết nối: nhận khoá mới → triển khai → báo EWS thu hồi khoá cũ.
* Giữ khoá ở phía máy chủ của app. Không nhúng vào trình duyệt hay ứng dụng di động.

**Giới hạn nguồn gọi (nếu app đã khai):**

* **IP:** so khớp **đúng từng địa chỉ**, chưa hỗ trợ dải (`10.20.0.0/16` sẽ **không** khớp gì).
  Đổi IP máy chủ thì báo EWS: thêm IP mới trước, gỡ IP cũ sau, để không có lúc bị chặn.
  Đã khai ít nhất một IP thì mọi IP khác bị chặn.
* **Origin:** chỉ xét khi request có header `Origin` (gọi từ trình duyệt). Gọi máy-chủ-tới-máy-chủ
  không bị luật này chặn.

Kiểm khoá và quyền được cấp:

```http
GET $EWS/v1/me
Authorization: Bearer <khoá>
```

Trả `status` của app và `grantedChannels`. Phải có `"email"` trong đó mới gửi được.

*Nguồn: `apps-api.test.ts` — "/v1/me", "allowlist IP", "cấp key", "5 request cấp key song song".*

---

## 3. Năm bước tích hợp

| # | Việc | Ai làm |
| --- | --- | --- |
| 1 | Tạo app, duyệt, cấp khoá API | **EWS** |
| 2 | Tạo chủ đề **và kích hoạt** | **EWS** |
| 3 | Khai báo nhân viên + email | **đội app** |
| 4 | Dựng màn "Cài đặt nhận thông báo" cho nhân viên | **đội app** |
| 5 | Gọi gửi — mỗi người một lời gọi, **kèm `idempotencyKey`** | **đội app** |

### Bước 3 — Khai báo nhân viên

EWS **không biết nhân viên nào tồn tại** cho tới khi app khai. Chưa khai mà gửi →
`RECIPIENT_NOT_FOUND`. Đây là lỗi hay gặp nhất.

```http
PUT $EWS/v1/users/NV-0123
Authorization: Bearer <khoá>
Content-Type: application/json

{ "email": "an.nguyen@company.com" }
```

* `NV-0123` là **mã của chính app bạn** (`externalId`): chữ, số và `. _ - : @ |`, tối đa 255 ký tự,
  không khoảng trắng. Hai app khác nhau dùng cùng một mã là **hai người khác nhau** với EWS.
* Tạo mới → `201`, đã có → `200`. Gọi lại y hệt bao nhiêu lần cũng được — nên gọi mỗi khi hồ sơ
  nhân viên thay đổi.
* **Bỏ trống `email`** → chỉ khai người, email hiện có giữ nguyên.
* Email được chuẩn hoá (bỏ khoảng trắng, viết thường) nhưng **giữ nguyên `+tag`**.
* Một địa chỉ chỉ thuộc **một** người trong app → trùng thì `409 EMAIL_TAKEN`.

Đọc lại: `GET /v1/users/NV-0123` (không có → `404`).

*Nguồn: `users-api.test.ts` — 4 test đầu, "email đã thuộc user khác", "app khác không thấy user".*

### Bước 4 — Màn "Cài đặt nhận thông báo"

Nhân viên **chỉ tắt được thông báo qua màn do app bạn dựng**. EWS không có trang nào cho nhân viên
tự vào. Không có màn này thì nhân viên **vĩnh viễn không tắt được gì**, và mọi lớp kiểm quyền nhận
của EWS trở nên vô nghĩa. Lúc duyệt app, EWS sẽ hỏi bạn đã có màn này chưa.

Đọc lựa chọn hiện tại:

```http
GET $EWS/v1/users/NV-0123/preferences
```

```json
{
  "externalId": "NV-0123",
  "email": { "status": "active", "optedOutOptional": false },
  "topics": [
    { "key": "order_updates", "name": "Cập nhật đơn hàng", "mandatory": false,
      "defaultMode": "opt_out", "optedIn": null, "effectiveOptIn": true }
  ]
}
```

* `optedIn`: nhân viên **đã bấm** gì. `null` = chưa bấm, đang theo mặc định.
* `effectiveOptIn`: chủ đề này **có qua được lớp chủ đề không** — dùng để hiện trạng thái công tắc.
* `defaultMode`: `opt_out` = mặc định **nhận**, ai không muốn thì tắt; `opt_in` = mặc định
  **không nhận**, phải tự bật.
* `mandatory: true`: tin bắt buộc (bảo mật, tài khoản…). **Không tắt được** — hiện công tắc khoá.

Ghi lựa chọn:

```http
PUT $EWS/v1/users/NV-0123/preferences
Content-Type: application/json

{ "topics": { "order_updates": false }, "optedOutOptional": false }
```

* Hai trường đều tuỳ chọn. `optedOutOptional: true` = **tắt mọi tin không bắt buộc** một lần.
* **Kiểm hết rồi mới ghi**: một chủ đề sai thì cả request bị từ chối, không có gì được lưu.
* Tắt chủ đề bắt buộc → `422 TOPIC_MANDATORY`. Chủ đề không tồn tại / chưa kích hoạt →
  `422 TOPIC_NOT_FOUND`. Đặt `optedOutOptional` cho người chưa có email → `422 EMAIL_NOT_SET`.

*Nguồn: `topics-api.test.ts` — "mặc định", "tắt / bật topic", "tắt topic mandatory", "optedOutOptional".*

### Bước 5 — Gửi

```http
POST $EWS/v1/notifications
Authorization: Bearer <khoá>
Content-Type: application/json

{
  "to": { "externalId": "NV-0123" },
  "topic": "order_updates",
  "subject": "Đơn OS10527 đã giao",
  "html": "<p>Đơn của bạn đã giao.</p>",
  "text": "Đơn của bạn đã giao.",
  "idempotencyKey": "order-OS10527-delivered-NV-0123"
}
```

* **`202` = EWS đã nhận, CHƯA gửi.** Thư đi sau, trong hàng đợi. Header `Location` trỏ tới chỗ
  theo dõi.
* `subject`: bắt buộc, tối đa 998 ký tự, **không xuống dòng**. `html`: bắt buộc. `text`: tuỳ chọn,
  nên có. Mỗi phần thân tối đa 256 KB.
* Không cần tự chèn link huỷ đăng ký — MVP chưa có (xem mục 9).

*Nguồn: `notifications-api.test.ts` — "202 queued", "lỗi input", "HTML 300 KB".*

---

## 4. `idempotencyKey` — bắt buộc trên thực tế

Mạng chập chờn, bạn gọi lại. Không có `idempotencyKey` thì **mỗi lần gọi lại là một lá thư trùng**
trong hộp thư nhân viên.

* Cùng khoá gọi lần hai → `200` kèm **bản cũ**, không gửi lần hai.
* EWS **không so nội dung**: cùng khoá mà khác nội dung vẫn trả bản cũ. Khoá phải đại diện cho
  *"lá thư này, cho người này"* — ví dụ `order-OS10527-delivered-NV-0123`, không dùng khoá ngẫu
  nhiên sinh mới mỗi lần thử.
* Khoá riêng theo app, tối đa 255 ký tự.

*Nguồn: `notifications-api.test.ts` — "trùng idempotencyKey".*

---

## 5. Theo dõi một lá thư

```http
GET $EWS/v1/notifications/<id>
```

| `status` | Nghĩa | App làm gì |
| --- | --- | --- |
| `queued` | đang chờ trong hàng | chờ |
| `sending` | đang gửi | chờ |
| `sent` | **máy chủ thư đã nhận** — chưa chắc đã vào hộp thư | xong |
| `no_recipient` | **không gửi** vì người nhận bị chặn — xem `recipient.exclusionReason` | không gửi lại |
| `failed` | gửi không được — xem `recipient.error` | xem dưới |

`recipient.exclusionReason` khi `no_recipient`:

| Giá trị | Nghĩa |
| --- | --- |
| `no_channel` | người này chưa khai email |
| `opted_out` | đã tắt chủ đề này (hoặc chủ đề `opt_in` mà chưa bật) |
| `opted_out_optional` | đã tắt mọi tin không bắt buộc |
| `suppressed` | email đã bị ngắt (xem mục 7) — chặn **cả tin bắt buộc** |
| `invalid` | địa chỉ không dùng được — chặn **cả tin bắt buộc** |

**`failed` có `error` bắt đầu bằng `outcome_unknown`**: máy chủ thư không trả lời kịp, **không biết
thư đã đi hay chưa**. EWS **không tự gửi lại** để nhân viên không nhận hai lần. Muốn gửi lại thì gọi
gửi mới với **khoá `idempotencyKey` mới** — và chấp nhận khả năng người nhận có hai thư.

Thư của app khác → `404`, như thể không tồn tại.

*Nguồn: `notifications-api.test.ts` — khối "gate L0 / L1 / L3", "chuyển phát at-most-once", "GET /v1/notifications/:id".*

---

## 6. Gửi cho nhiều người

App lặp, mỗi người một lời gọi. Hai điều cần biết:

* **EWS nhận ngay nhưng gửi dần.** Mọi app dùng chung một hộp thư gửi của công ty, và hộp thư đó
  bị giới hạn tốc độ (mặc định **30 thư/phút**, đội EWS cấu hình). 1 000 lời gọi nhận xong trong vài
  giây, nhưng thư cuối có thể đi sau hơn nửa giờ — lâu hơn nữa nếu app khác cũng đang gửi.
  **Đừng dùng EWS cho tin cần tới trong vài giây với số đông.**
* **Người bị chặn không làm hỏng vòng lặp.** Người đã tắt chủ đề vẫn cho `202`, rồi kết thúc
  `no_recipient`. Chỉ người **chưa khai** mới lỗi ngay (`RECIPIENT_NOT_FOUND`) — khai bổ sung rồi
  gọi lại cho riêng người đó.

---

## 7. Hai chính sách đội app phải tự giữ

EWS không ép được hai điều này. Đó là quyết định của đội app — nhưng phải biết hậu quả trước.

### Không tái dùng mã nhân viên (`externalId`)

Lựa chọn nhận tin gắn với mã. Cấp lại mã của người đã nghỉ cho người mới thì người mới **thừa kế
nguyên** lựa chọn của người cũ:

* Người cũ đã tắt chủ đề → người mới cũng không nhận.
* Người cũ đã bị ngắt email → người mới **vẫn bị ngắt, kể cả khi app khai địa chỉ mới** (xem dưới).

Không lỗi, không cảnh báo — chỉ là thư không tới.

### Nhân viên nghỉ việc → ngắt email ngay

```http
DELETE $EWS/v1/users/NV-0123/email
```

EWS không nối vào hệ thống nhân sự, **không tự biết ai đã nghỉ**. Không gọi thì EWS vẫn giữ địa
chỉ và vẫn gửi. EWS **chưa tự xử lý thư dội về**, nên thư sẽ gửi mãi vào hộp thư đã đóng — và uy tín
hộp thư gửi của cả công ty đi xuống, tới mức thư của mọi app bị đưa vào mục rác.

Sau khi ngắt, email ở trạng thái `unsubscribed`:

* Chặn **mọi** thư, kể cả tin bắt buộc.
* Gọi lại `DELETE` không sao (không đổi gì).
* **Bật lại:** `PUT /v1/users/NV-0123` với **đúng địa chỉ cũ**. Chỉ làm khi chính người đó muốn
  nhận lại (ví dụ quay lại làm việc).
* Khai **địa chỉ khác** thì địa chỉ được đổi nhưng **vẫn `unsubscribed`** — EWS không coi việc đổi
  địa chỉ là người đó đồng ý nhận lại.

*Nguồn: `users-api.test.ts` — "user tự ngắt (DELETE)", "user đã tự ngắt, app ĐỔI địa chỉ", "user không tồn tại".*

---

## 8. Mã lỗi

Mọi lỗi trả `Content-Type: application/problem+json`. **Xử lý theo `code`, không theo câu chữ
trong `detail`** — câu chữ có thể đổi, `code` thì không.

**Lỗi dữ liệu (`422`) có mã cụ thể nằm trong `issues`**, còn `code` ở ngoài chỉ là `VALIDATION`:

```json
{
  "status": 422,
  "code": "VALIDATION",
  "detail": "user NV-0999 does not exist: sync it first with PUT /v1/users/:externalId",
  "issues": [{ "code": "RECIPIENT_NOT_FOUND", "message": "…", "path": "to.externalId" }]
}
```

| HTTP | Mã | Ở đâu | Nghĩa · App làm gì |
| --- | --- | --- | --- |
| 401 | `API_KEY_REQUIRED` | mọi `/v1` | Thiếu header `Authorization`. |
| 401 | `INVALID_API_KEY` | mọi `/v1` | Khoá sai hoặc đã thu hồi. Không thử lại — xin khoá mới. |
| 403 | `APP_NOT_ACTIVE` | mọi `/v1` | App đang tạm ngưng hoặc đã thu hồi. Liên hệ EWS. |
| 403 | `IP_NOT_ALLOWED` | mọi `/v1` | IP gọi tới không nằm trong danh sách đã khai (so khớp đúng từng địa chỉ). |
| 403 | `ORIGIN_NOT_ALLOWED` | mọi `/v1` | Header `Origin` không nằm trong danh sách đã khai. |
| 422 | `RECIPIENT_NOT_FOUND` | gửi | Chưa khai người này — làm bước 3 rồi gọi lại. |
| 422 | `TOPIC_NOT_FOUND` | gửi, preferences | Sai `key`, chủ đề chưa kích hoạt (ở preferences), hoặc chủ đề của app khác. |
| 422 | `TOPIC_NOT_ACTIVE` | gửi | Chủ đề còn nháp hoặc đang tạm ngưng. Liên hệ EWS. |
| 422 | `CHANNEL_NOT_GRANTED` | gửi | App chưa được cấp kênh email lúc duyệt. Liên hệ EWS. |
| 422 | `EMAIL_SUBJECT_REQUIRED` · `EMAIL_SUBJECT_TOO_LONG` · `EMAIL_SUBJECT_INVALID` | gửi | Tiêu đề trống / quá 998 ký tự / có xuống dòng. |
| 422 | `EMAIL_HTML_REQUIRED` · `EMAIL_BODY_TOO_LARGE` | gửi | Thiếu `html` / một phần thân quá 256 KB. |
| 422 | `TOPIC_MANDATORY` | preferences | Cố tắt chủ đề bắt buộc. Không có đường lách. |
| 422 | `EMAIL_NOT_SET` | preferences | Đặt `optedOutOptional` cho người chưa có email. |
| 422 | `EMAIL_INVALID` | khai người | Email sai định dạng. |
| 422 | `INVALID_FIELD` | mọi `/v1` | Sai kiểu / thừa trường / mã nhân viên có ký tự lạ. `path` chỉ trường nào. |
| 409 | `EMAIL_TAKEN` | khai người | Địa chỉ đã thuộc người khác trong app. |
| 404 | `NOT_FOUND` | đọc người, preferences, ngắt email, đọc thư | Không có (hoặc thuộc app khác). |
| 400 | `MALFORMED_JSON` | mọi `/v1` | Body không phải JSON hợp lệ. |
| 413 | `PAYLOAD_TOO_LARGE` | mọi `/v1` | Request quá lớn (gửi thư: 512 KB; còn lại: 64 KB). |
| 500 | `INTERNAL` | mọi `/v1` | Lỗi phía EWS. |

**Thử lại khi nào:**

* `4xx`: **không** thử lại nguyên xi — gọi lại vẫn sai như thế. Sửa rồi mới gọi.
* `5xx` và hết thời gian chờ: thử lại có giãn cách, **giữ nguyên `idempotencyKey`**.
* MVP **chưa trả `429`** — chưa có hạn mức theo app (mục 9).

---

## 9. Những gì CHƯA có — đừng tìm

| Chưa có | Hệ quả cho app |
| --- | --- |
| Gửi hàng loạt theo chủ đề / phân khúc | App tự lặp từng người (mục 6). |
| Template | App tự dựng `subject` / `html` / `text`. |
| Hẹn giờ, huỷ, dừng, gửi lại | Gọi lúc nào thì xếp hàng lúc đó. Thư đã nhận không huỷ được. |
| Xử lý thư dội về | Chính sách "nghỉ việc → ngắt email" (mục 7) là lớp bảo vệ duy nhất. |
| Link "Quản lý thông báo" trong thư | Màn cài đặt của app (bước 4) là cửa duy nhất. |
| Hạn mức theo app (`429`) | Hạn mức ghi lúc duyệt app chưa được đối chiếu. |
| Gọi ngược (webhook) báo kết quả | Hỏi `GET /v1/notifications/:id` khi cần. |
| Kênh khác email | Chỉ email. |

---

## 10. Tra cứu phía EWS

Nhân viên báo "không nhận được thư": gửi đội EWS **mã nhân viên** và **mã lá thư** (`id` trả về
lúc gửi). Người trực EWS tra được, không cần hỏi lại:

* **Màn Người nhận** — người này có email chưa, đã tắt chủ đề nào, có bị ngắt không.
* **Màn Lịch sử gửi** — từng lá thư gửi người này ra sao, lúc nào, bị chặn vì đâu.
