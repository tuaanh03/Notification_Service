# Hướng dẫn tích hợp EWS gửi email — cho đội app

*Tách từ ĐX-0004 phần 3 (2026-09-21), bổ sung địa chỉ thật 2026-09-23. Áp dụng cho **MVP**: chỉ
email, gửi từng người.*

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

Gửi hàng loạt theo phân khúc, hẹn giờ: **chưa có** (xem mục 9). Gửi bằng **template** do EWS soạn
sẵn: **có** (bước 5, cách 2).

---

## 2. EWS đưa cho bạn những gì

| Thứ | Ghi chú |
| --- | --- |
| **Địa chỉ API** | `https://api-ews-astrolink.eonsr.net` — dưới đây viết là `$EWS`. Mọi đường dẫn bắt đầu bằng `/v1`. |
| **Khoá API** | Dạng `ews_<32 hex>_<43 ký tự>`. **Chỉ hiện một lần** lúc cấp — mất là phải cấp khoá mới. |
| **Danh sách chủ đề** | Đội EWS tạo và kích hoạt. App không tạo được chủ đề. Đọc lại bằng `GET /v1/topics`. |

**Địa chỉ API:**

* **Chỉ `https`.** Gọi `http://` sẽ bị chuyển sang `https` — đừng dựa vào việc chuyển này, cấu hình
  thẳng `https://` để khoá API không bao giờ đi qua mạng dạng chữ trần.
* Gọi được **từ Internet**, không cần VPN. Muốn chỉ máy chủ của app gọi được thì khai IP (dưới).
* Địa chỉ này chỉ mở `/v1` và `/health`. Trang quản trị EWS là địa chỉ khác, chỉ đội EWS dùng.
* EWS còn sống không: `GET $EWS/health/ready` (không cần khoá) → `200` kèm
  `{"status":"ok","checks":{"mysql":"ok","redis":"ok"}}`.

**Khoá API:**

* Gửi thẳng: `Authorization: Bearer <khoá>`. **Không có bước đổi khoá lấy token.**
* Mỗi nơi gọi EWS (backend, job, môi trường thử…) nên dùng **một khoá riêng**, đặt tên lúc cấp để biết
  khoá nào dùng ở đâu. Màn Credentials hiện "Dùng lần cuối" của từng khoá.
* Cấp khoá mới **không** thu hồi khoá cũ — đổi khoá không mất kết nối: cấp khoá mới → triển khai →
  thu hồi khoá cũ. Số khoá đang dùng có giới hạn (mặc định 20 mỗi app); đủ thì thu hồi bớt khoá cũ.
* Giữ khoá ở phía máy chủ của app. Không nhúng vào trình duyệt hay ứng dụng di động.

**Giới hạn IP (tuỳ chọn, do đội EWS khai):** muốn chỉ máy chủ của app gọi được thì báo đội EWS danh
sách IP. Đã khai ít nhất một IP thì mọi IP khác bị chặn (`IP_NOT_ALLOWED`) — cả `/v1` lẫn incoming webhook.
So khớp **đúng từng địa chỉ**, chưa hỗ trợ dải (`10.20.0.0/16` sẽ **không** khớp gì). Đổi IP máy chủ thì
báo EWS: thêm IP mới trước, gỡ IP cũ sau, để không có lúc bị chặn.

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
| 1 | Tạo app, cấp khoá API trên console EWS — tạo xong là dùng được, không chờ duyệt | **đội app** (Owner / Org Admin của org) |
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
* Người bị **xoá trên console EWS** coi như không còn: `GET` → `404`, gửi → `422 RECIPIENT_NOT_FOUND`,
  không nhận tin phát vào chủ đề. App `PUT` lại cùng mã → người đó **dùng lại được** (`201`), lịch sử gửi
  và trạng thái email cũ giữ nguyên.

Đọc lại: `GET /v1/users/NV-0123` (không có → `404`).

*Nguồn: `users-api.test.ts` — 4 test đầu, "email đã thuộc user khác", "app khác không thấy user".*

### Bước 4 — Màn "Cài đặt nhận thông báo"

Nhân viên **chỉ tắt được thông báo qua màn do app bạn dựng**. EWS không có trang nào cho nhân viên
tự vào. Không có màn này thì nhân viên **vĩnh viễn không tắt được gì**, và mọi lớp kiểm quyền nhận
của EWS trở nên vô nghĩa. Không còn bước EWS duyệt app — dựng màn này **trước** khi bắt đầu gửi là trách nhiệm của đội app.

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

#### Dựng màn này thế nào

**EWS là nơi duy nhất giữ lựa chọn của nhân viên. Màn của app chỉ là giao diện đặt lên EWS.**

* **Mở màn** → gọi `GET .../preferences`, vẽ từ kết quả. **Bấm Lưu** → gọi `PUT .../preferences`.
  Không lưu bản sao lựa chọn trong database của app.
* **Không viết cứng danh sách chủ đề trong code.** Kết quả `GET` chỉ chứa chủ đề **đang kích hoạt**:
  EWS thêm chủ đề mới thì nó tự hiện, tạm ngưng thì tự biến mất — app không phải sửa gì. Danh sách
  viết cứng sẽ lệch, và gửi một chủ đề đã tạm ngưng làm **cả lần Lưu** bị từ chối (`TOPIC_NOT_FOUND`).
* `PUT` trả về **đúng khuôn của `GET`**, đã cập nhật — vẽ lại màn từ đó, không cần gọi `GET` lần nữa.

Vẽ từng phần:

| Dữ liệu | Hiện thế nào |
| --- | --- |
| `name` | Nhãn của công tắc. |
| `effectiveOptIn` | Trạng thái công tắc (bật/tắt). **Không** dùng `optedIn` — `null` không vẽ được. |
| `mandatory: true` | Công tắc **bật và khoá**, ghi rõ "bắt buộc". |
| `email.optedOutOptional: true` | Người này đã tắt mọi tin không bắt buộc. Công tắc từng chủ đề **vẫn giữ nguyên giá trị** (`effectiveOptIn` không tính lớp này) — hiện chúng mờ đi kèm dòng "Đang tắt mọi thông báo không bắt buộc", để bật lại lớp chung thì lựa chọn cũ quay về. |
| `email: null` | Người này chưa có email. Chưa có gì để cài — hiện thông báo, không hiện công tắc. |
| `email.status` khác `active` | `unsubscribed` (đã ngắt) hoặc `invalid` (địa chỉ hỏng): **không thư nào tới**, kể cả tin bắt buộc. Hiện rõ lý do; công tắc chủ đề không còn tác dụng. |

Ghi lựa chọn:

* **Chỉ gửi chủ đề nhân viên vừa đổi.** Chủ đề không nhắc tới trong `topics` được **giữ nguyên**.
* Nút **"Tắt mọi thông báo không bắt buộc"** = `{ "optedOutOptional": true }`; bật lại = `false`.
  Không truyền trường này = giữ nguyên.
* Không gửi `false` cho chủ đề bắt buộc (bị từ chối). Gửi `true` cho chủ đề bắt buộc thì EWS bỏ qua.

#### App đã có sẵn cài đặt thông báo riêng

Chuyển **một lần**, sau đó dùng cách trên và bỏ bảng cài đặt cũ:

1. Đội app và đội EWS cùng chốt bảng ghép **loại tin cũ của app ↔ `key` chủ đề EWS**. EWS không tự
   đoán được; loại tin không ghép được thì bỏ.
2. Khai nhân viên trước (bước 3), rồi lặp `PUT .../preferences` cho từng người, **chỉ gửi những chủ
   đề người đó đã đổi khác mặc định**. Không gửi gì = theo mặc định của chủ đề.
3. Lỗi `TOPIC_NOT_FOUND` / `TOPIC_MANDATORY` giữa chừng = bảng ghép sai. Cả lần gọi của người đó
   không được lưu — sửa bảng ghép rồi chạy lại. Chạy lại không sao: lựa chọn không đổi thì EWS
   không ghi.

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
* App có đặt **khung giờ gửi** (console: Cài đặt App › Giới hạn gửi) mà thư tới ngoài khung -> `status`
  là `scheduled`, `scheduledAt` là lúc khung mở; tới giờ thư tự đi, app không gọi lại. Tin của chủ đề bắt
  buộc mặc định bỏ qua khung giờ.
* `subject`: bắt buộc, tối đa 998 ký tự, **không xuống dòng**. `html`: bắt buộc. `text`: tuỳ chọn,
  nên có. Mỗi phần thân tối đa 256 KB.
* Không cần tự chèn link huỷ đăng ký — MVP chưa có (xem mục 9).

*Nguồn: `notifications-api.test.ts` — "202 queued", "lỗi input", "HTML 300 KB".*

#### Cách 2 — gửi bằng template

Người lo nội dung soạn template trên console EWS rồi bấm **Xuất bản**. App chỉ gửi **mã template**
và **dữ liệu để đổ vào** — không gửi `subject` / `html` / `text`:

```http
POST $EWS/v1/notifications
Authorization: Bearer <khoá>
Content-Type: application/json

{
  "to": { "externalId": "NV-0123" },
  "topic": "vm_alerts",
  "templateId": "3f2a9c1e-7b4d-4e8a-9f10-2c6d5e8b1a73",
  "payload": { "vm_name": "ai-gateway", "threshold": 80 },
  "idempotencyKey": "vm-ai-gateway-high-load-2026-09-30T09:00-NV-0123"
}
```

* **Một trong hai cách cho mỗi lời gọi.** Gửi cả `templateId` lẫn `subject` / `html` / `text` →
  `CONTENT_AND_TEMPLATE_CONFLICT`. Gửi `payload` mà không có `templateId` → `PAYLOAD_REQUIRES_TEMPLATE`.
* **EWS luôn dùng bản đang xuất bản.** Người soạn xuất bản bản mới thì từ lần gọi kế tiếp thư theo
  bản mới — app không sửa gì. Thư đã nhận (`202`) trước đó giữ nguyên bản cũ.
* **Đổ biến ngay lúc nhận lời gọi.** Thiếu dữ liệu thì bị từ chối ngay (`422`), không có thư nào đi
  ra với chỗ trống.
* `payload`: object phẳng, **tối đa 2 KB**. Giá trị là chữ, số hoặc `true` / `false` — object, mảng,
  `null` → `INVALID_PAYLOAD_VALUE`. Khoá mà template không dùng thì **bị bỏ qua**, không lỗi.
* Biến nào bắt buộc, tên là gì: xem ở trang template trên console. Template dùng `{{ payload.vm_name }}`
  thì app gửi `"payload": { "vm_name": … }`. Riêng `{{ user.external_id }}` EWS tự điền bằng
  `to.externalId`.
* Giá trị đổ vào phần HTML được EWS **escape** (`<b>` hiện ra đúng chữ `<b>`, không thành chữ đậm).
  Muốn thư có định dạng khác thì sửa template, không nhét HTML vào `payload`.
* Biến dùng làm link (`href="{{ payload.url }}"`) phải ra `https://…` hoặc `mailto:…` — khác đi là
  `LINK_SCHEME_NOT_ALLOWED`.

**Hai điều đội app phải nhớ:**

1. **Mã template khác nhau giữa các môi trường.** Cùng template "Cảnh báo VM" trên máy thử và trên
   máy thật là hai mã khác nhau. Để `templateId` trong cấu hình theo môi trường, cạnh khoá API —
   đừng viết cứng trong code.
2. **Người soạn thêm biến BẮT BUỘC mới = app phải gửi thêm biến đó.** Từ lúc bản mới được xuất bản,
   lời gọi thiếu biến sẽ bị `MISSING_VARIABLE`. Hai bên thống nhất trước khi xuất bản.

*Nguồn: `notifications-api.test.ts` — khối "gửi bằng template".*

### Chạy thử cả vòng trong 5 phút

Chạy trước khi viết code: qua được là khoá, mạng và chủ đề đã thông. Cần `curl`, `jq`, khoá API và
`key` của một chủ đề **đã kích hoạt** (lấy ở `GET /v1/topics`).

```bash
EWS=https://api-ews-astrolink.eonsr.net
read -s -p 'Khoá API: ' KEY; echo
TOPIC='<key chủ đề>'
AUTH="Authorization: Bearer $KEY"

# 1. Khoá dùng được? -> "status":"active" và "grantedChannels" có "email"
curl -s $EWS/v1/me -H "$AUTH" | jq

# 2. Khai một nhân viên thử (201 lần đầu, 200 các lần sau)
curl -s -X PUT $EWS/v1/users/NV-TEST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"email":"<email của chính bạn>"}' | jq

# 3. Gửi -> 202, lấy id lá thư
ID=$(jq -n --arg t "$TOPIC" --arg k "thu-$(date +%s)" \
  '{to:{externalId:"NV-TEST"},topic:$t,subject:"EWS chạy thử",html:"<p>EWS chạy thử</p>",idempotencyKey:$k}' \
  | curl -s -X POST $EWS/v1/notifications -H "$AUTH" -H 'Content-Type: application/json' -d @- | jq -r .id)
echo "id: $ID"

# 4. Vài giây sau: "status" từ queued -> sent
curl -s $EWS/v1/notifications/$ID -H "$AUTH" | jq

unset KEY AUTH
```

* Dùng **email của chính bạn** cho `NV-TEST`: khi EWS đã bật gửi thật, thư chạy thử **đi thật**.
* Bước 3 in `id: null` → xem lỗi bằng cách chạy lại lệnh gửi không có `| jq -r .id`, tra mục 8.
* EWS không xoá được người đã khai. Luôn dùng lại đúng mã `NV-TEST` cho mọi lần chạy thử, đừng
  sinh mã mới mỗi lần.

### Sau khi tích hợp: lúc nào app phải gọi EWS

EWS **không tự hỏi** app. Dữ liệu bên app đổi thì **app chủ động gọi** — ngay lúc đổi, không đợi
cuối ngày:

| Bên app xảy ra | App gọi |
| --- | --- |
| Lần đầu nối vào EWS | `PUT /v1/users/:externalId` **lặp cho mọi nhân viên hiện có** |
| Thêm nhân viên / đổi email | `PUT /v1/users/:externalId` |
| Nhân viên đổi cài đặt nhận thông báo | `PUT /v1/users/:externalId/preferences` |
| Nhân viên nghỉ việc | `DELETE /v1/users/:externalId/email` (mục 7) |
| Cần gửi thư | `POST /v1/notifications` (bước 5) |
| Muốn biết thư đã đi chưa | `GET /v1/notifications/:id`, hoặc để EWS tự báo qua webhook (mục 5) |

Các lời gọi đổi dữ liệu ghi **trạng thái cuối**, không phải "vừa đổi gì" — gọi lại bao nhiêu lần
kết quả vẫn thế. Lỗi mạng thì cứ gọi lại, không cần nhớ đã gọi hay chưa.

EWS **chưa nhận khai nhiều người trong một lời gọi** — đồng bộ lần đầu là lặp từng người.

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
| `scheduled` | chờ khung giờ gửi của app mở — lúc mở ở `scheduledAt` | chờ, không gửi lại |
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

Gửi bằng template thì kết quả có thêm `"template": { "id": "…", "version": 3 }` — bản đã dùng cho
lá thư đó. Gửi bằng nội dung viết thẳng thì `"template": null`.

`publicationId`: thư thuộc một lần phát vào chủ đề (mục 6) thì là `id` của lần phát đó, gửi lẻ thì `null`.

Thư của app khác → `404`, như thể không tồn tại.

*Nguồn: `notifications-api.test.ts` — khối "gate L0 / L1 / L3", "chuyển phát at-most-once", "GET /v1/notifications/:id".*

### Để EWS tự báo kết quả — webhook

Thay vì hỏi `GET` nhiều lần, app dựng **một route nhận** và để EWS gọi sang mỗi khi một lá thư có kết quả.

**Đăng ký** trên console EWS: app → **Webhooks** → Thêm URL (người có quyền quản lý app).

* URL phải là `https://`, gọi được từ internet. URL trỏ vào mạng nội bộ (`10.x`, `192.168.x`, `localhost`…) bị từ chối.
* Chọn sự kiện muốn nhận. Mỗi app đăng ký được nhiều URL (mặc định tối đa 10).
* EWS hiện **secret** (`whsec_…`) **một lần duy nhất** — cất vào cấu hình như API key. Mất thì bấm
  "Đổi secret" (secret cũ hết hiệu lực ngay).

**EWS gọi sang:**

```http
POST https://app.cua-ban.com/ews-webhook
Content-Type: application/json
X-EWS-Event: notification.sent
X-EWS-Delivery-Id: <id lần gọi>
X-EWS-Signature: t=1791625213,v1=9f2c…

{
  "id": "4c0e…",
  "type": "notification.sent",
  "createdAt": "2026-10-10T09:40:13.411Z",
  "data": {
    "notificationId": "…", "publicationId": null, "externalId": "NV-0123", "topic": "order_updates",
    "status": "sent", "exclusionReason": null, "error": null
  }
}
```

| `type` | Khi nào | `data` đáng chú ý |
| --- | --- | --- |
| `notification.sent` | Máy chủ thư đã nhận | — |
| `notification.failed` | Gửi không được | `error` (bắt đầu `outcome_unknown` = không rõ đã đi chưa) |
| `notification.no_recipient` | Không gửi vì người nhận bị chặn | `exclusionReason` (bảng phía trên) |
| `notification.opened` | Người nhận mở thư **lần đầu** — chỉ khi app bật "Theo dõi mở thư" trên console | `openedAt` (chỉ sự kiện này có) |
| `ping` | Bấm "Gửi thử" trên console | `data` rỗng |

`notification.opened` là số **ước tính**: EWS biết "đã mở" khi ứng dụng mail tải ảnh nhỏ trong thư. Ứng
dụng chặn ảnh thì đã mở vẫn không có sự kiện; mở lại nhiều lần chỉ có **một** sự kiện. Mỗi thư vì vậy có
một sự kiện kết quả gửi và tối đa một sự kiện `notification.opened`, đến sau.

Body **không có** địa chỉ email và nội dung thư. Thư của một lần phát (mục 6) có `publicationId`.

**App phải làm ba việc:**

1. **Kiểm chữ ký** trên **body gốc** (chuỗi nhận được, chưa parse) — URL là công khai, ai cũng gọi
   giả được:

   ```js
   import crypto from 'node:crypto';

   function verify(rawBody, signatureHeader, secret) {
     const { t, v1 } = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
     if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // quá 5 phút: từ chối
     const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
     return expected.length === v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
   }
   ```

2. **Trả `2xx` trong 10 giây.** Việc nặng thì cất sự kiện rồi xử lý sau. Khác `2xx`, quá 10 giây, hay
   redirect đều tính là lỗi → EWS gọi lại sau **1 phút · 5 phút · 30 phút · 2 giờ · 6 giờ** rồi dừng
   (tổng 6 lần). Nhật ký từng lần gọi xem trên console.
3. **Bỏ bản trùng theo `id`.** Có thể nhận cùng một sự kiện hai lần (ví dụ app xử lý xong nhưng trả lời
   chậm). Thứ tự giữa các thư khác nhau **không đảm bảo**; mỗi thư chỉ có **một** sự kiện kết quả
   (cộng tối đa một `notification.opened`).

*Nguồn: `webhooks-api.test.ts`, `test/unit/webhooks.test.ts` — "chữ ký kiểm được bằng đúng đoạn code mẫu".*

---

## 6. Gửi cho nhiều người

Có hai cách.

### Cách 1 — phát vào chủ đề (tối đa 100 người)

Một lời gọi, EWS gửi cho **mọi người trong app đang theo dõi chủ đề đó**. App không cần biết danh sách.

```http
POST $EWS/v1/publications
Content-Type: application/json

{
  "topic": "bao_tri",
  "subject": "Bảo trì hệ thống 22:00 tối nay",
  "html": "<p>Hệ thống tạm ngưng từ 22:00 đến 23:00.</p>",
  "text": "Hệ thống tạm ngưng từ 22:00 đến 23:00.",
  "idempotencyKey": "bao-tri-2026-10-10"
}
```

Như gửi lẻ nhưng **không có `to`**. Nội dung viết thẳng hoặc `templateId` + `payload` (bước 5) — mọi
người nhận cùng `payload`; `{{ user.external_id }}` được đổ theo từng người.

**Ai nhận** — đúng luật của gửi lẻ (mục 5), chốt **ngay lúc gọi**:

| Người | Chủ đề `opt_out` | Chủ đề `opt_in` | Chủ đề bắt buộc |
| --- | --- | --- | --- |
| chưa chọn gì | nhận | không | nhận |
| đã bật chủ đề | nhận | nhận | nhận |
| đã tắt chủ đề / tắt mọi tin không bắt buộc | không | không | **nhận** |
| chưa có email / email đã ngắt / không dùng được | không | không | không |

* **`idempotencyKey` bắt buộc** (thiếu → `IDEMPOTENCY_KEY_REQUIRED`). Phát trùng là cả nhóm nhận
  thư trùng. Khoá đại diện cho *"lần phát này"* — ví dụ `bao-tri-2026-10-10`. Gọi lại cùng khoá →
  `200` kèm lần phát cũ, không gửi thêm. Khoá của lần phát và của gửi lẻ là hai tập riêng.
* **Quá 100 người theo dõi** → `422 PUBLICATION_TOO_LARGE`, không gửi cho ai. Dùng cách 2.
* **Không ai theo dõi** không phải lỗi: `202`, `"recipientCount": 0`.
* Người tắt chủ đề **sau** lúc phát nhưng **trước** khi tới lượt gửi thì không nhận (đếm vào `skipped`).

Kết quả `202` (và `GET $EWS/v1/publications/<id>` về sau):

```json
{
  "id": "…", "topic": "bao_tri", "template": null, "idempotencyKey": "bao-tri-2026-10-10",
  "status": "in_progress", "recipientCount": 37,
  "counts": { "pending": 37, "sent": 0, "failed": 0, "skipped": 0 },
  "recipients": [{ "externalId": "NV-0123", "notificationId": "…", "status": "queued" }],
  "scheduledAt": null,
  "createdAt": "…"
}
```

* `status`: `in_progress` khi còn thư chờ gửi, `completed` khi mọi thư đã có kết quả.
* `scheduledAt`: thư con đang chờ khung giờ gửi thì là lúc chúng sẽ đi; không thì `null`.
* `counts`: `pending` = `scheduled` + `queued` + `sending` · `sent` · `failed` · `skipped` = `no_recipient`.
* Mỗi người nhận là **một lá thư riêng** — tra chi tiết (lý do chặn, lỗi) bằng
  `GET /v1/notifications/<notificationId>` như mục 5.
* Lần phát của app khác → `404`.

*Nguồn: `publications-api.test.ts`.*

### Cách 2 — app tự lặp

Mỗi người một lời gọi `POST /v1/notifications`. Dùng khi danh sách do app quyết định (không theo chủ
đề), hoặc chủ đề quá 100 người.

### Cách 3 — hệ thống khác gọi vào (incoming webhook)

Dùng khi cái phát tin **không phải app của bạn** mà là một hệ thống chỉ biết gọi webhook: công cụ giám
sát, công cụ tự động hoá, dịch vụ / script của đội. Không cần API key.

**Tạo trên console EWS** (Cài đặt App → Webhooks → tab **Nhận vào** → Thêm webhook): chỉ chọn **gửi cho
người theo dõi topic nào** và **nội dung theo template nào**. Bấm **Sao chép URL** (lấy lại được bất cứ lúc
nào, mỗi lần lấy đều được ghi lại) rồi dán vào hệ thống kia. URL là chìa khoá — lộ thì bấm **Đổi URL** (URL
cũ ngừng ngay).

**Khuôn chuẩn của EWS — mọi hệ thống đều cấu hình đúng 4 thứ:**

| | Giá trị |
| --- | --- |
| Phương thức | `POST` |
| URL | `https://<domain API EWS>/hooks/ewshk_…` (console đưa) |
| Header | `Content-Type: application/json` |
| Body | JSON có các trường **trùng tên biến** của template (bỏ `payload.`) |

Ví dụ template có biến `payload.title` (bắt buộc) và `payload.name_issue` (bắt buộc):

```json
{ "title": "VM web-01 quá tải", "name_issue": "CPU > 95% trong 5 phút" }
```

* Console tự dựng body mẫu từ template (kèm giá trị mẫu và mô tả người soạn template đã khai) và hiện
  **thư mẫu** người nhận sẽ thấy — mục **Body mẫu** của từng webhook.
* Hệ thống gọi thay giá trị ví dụ bằng giá trị thật — thường là biến / chỗ trống của chính hệ thống đó.
  Chữ, số, `true` / `false`; mảng chữ / số được nối bằng dấu phẩy; chuỗi rỗng coi như không có.
* Trường thừa bị bỏ qua. Template **không có biến** (nội dung cố định): body `{}` là đủ.
* **Trùng lặp EWS tự lo:** cùng nội dung trong một khung thời gian (mặc định 10 phút, Super Admin chỉnh
  được) chỉ gửi một lần. Muốn tự quyết thì gửi header `Idempotency-Key` — cùng khoá là cùng một lần gửi.
* Giới hạn mặc định 20 lần gửi / phút mỗi hook (Super Admin chỉnh được) — chặn "bão" cảnh báo.

**EWS trả về:**

| HTTP | Body / mã | Nghĩa |
| --- | --- | --- |
| 202 | `{"status":"published","publicationId":"…","recipientCount":12}` | Đã gửi (như cách 1) |
| 200 | `{"status":"duplicate", …}` | Trùng lần gọi trước — không gửi lại |
| 404 | `NOT_FOUND` | URL sai, hook đã tắt hoặc đã xoá |
| 403 | `APP_NOT_ACTIVE` · `IP_NOT_ALLOWED` | Như `/v1` |
| 422 | `MISSING_VARIABLE` · `INVALID_PAYLOAD_VALUE` · `INCOMING_BODY_INVALID` · `PUBLICATION_TOO_LARGE` · lỗi template | Body thiếu / sai trường, hoặc template / topic chưa sẵn sàng |
| 429 | `INCOMING_HOOK_RATE_LIMITED` | Gọi quá số lần mỗi phút |

Mọi lần gọi có trong **Nhật ký** của webhook trên console 30 ngày, viết bằng lời ("Đã gửi cho 12 người",
"Trùng lần trước", "Thiếu trường bắt buộc: service"). EWS không lưu body, chỉ lưu tên trường bị lỗi.

**Ví dụ cấu hình — Gatus** (kênh `custom`, body tự viết; `send-on-resolved` quyết có báo lúc hết sự cố):

```yaml
alerting:
  custom:
    url: "https://<domain API EWS>/hooks/ewshk_…"
    method: "POST"
    headers:
      Content-Type: application/json
    body: |
      { "title": "[ENDPOINT_NAME]", "name_issue": "[ALERT_DESCRIPTION]" }
    default-alert:
      send-on-resolved: false
```

Hệ thống khác cũng vậy: đặt URL, header, và body theo các trường của template bằng biến của hệ thống đó.

**Trường hợp đặc biệt — hệ thống chỉ gửi được JSON cố định của nó** (không sửa được body): EWS có cơ chế
ánh xạ đường dẫn JSON (`a.b`, `a[0]`, `a[-1]`, `a["k.k"]`), điều kiện phát và đường dẫn khoá chống trùng
(ADR-0030). Phần này **không có trên console** — liên hệ đội EWS để cấu hình qua API
(`PATCH /admin/apps/:appId/incoming-webhooks/:hookId`).

*Nguồn: `incoming-api.test.ts`, `incoming-extraction.test.ts`.*

### Cả ba cách

Hai điều cần biết:

* **EWS nhận ngay nhưng gửi dần.** Mọi app dùng chung một hộp thư gửi của công ty, và hộp thư đó
  bị giới hạn tốc độ (mặc định **30 thư/phút**, đội EWS cấu hình). 1 000 lời gọi nhận xong trong vài
  giây, nhưng thư cuối có thể đi sau hơn nửa giờ — lâu hơn nữa nếu app khác cũng đang gửi. Một lần
  phát 50 người cũng mất khoảng 2 phút mới đi hết.
  **Đừng dùng EWS cho tin cần tới trong vài giây với số đông.**
* **Người bị chặn không làm hỏng vòng lặp (cách 2).** Người đã tắt chủ đề vẫn cho `202`, rồi kết thúc
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
| 403 | `IP_NOT_ALLOWED` | mọi `/v1` | IP gọi tới không nằm trong danh sách đã khai (so khớp đúng từng địa chỉ). Báo đội EWS thêm IP. |
| 422 | `RECIPIENT_NOT_FOUND` | gửi | Chưa khai người này — làm bước 3 rồi gọi lại. |
| 422 | `IDEMPOTENCY_KEY_REQUIRED` | phát | Lần phát vào chủ đề phải có `idempotencyKey` (mục 6). |
| 422 | `PUBLICATION_TOO_LARGE` | phát | Chủ đề có quá 100 người theo dõi. Không ai nhận thư — gửi lẻ từng người. |
| 422 | `TOPIC_NOT_FOUND` | gửi, phát, preferences | Sai `key`, chủ đề chưa kích hoạt (ở preferences), hoặc chủ đề của app khác. |
| 422 | `TOPIC_NOT_ACTIVE` | gửi, phát | Chủ đề còn nháp hoặc đang tạm ngưng. Liên hệ EWS. |
| 422 | `CHANNEL_NOT_GRANTED` | gửi, phát | App chưa được cấp kênh email (chỉ gặp ở app tạo trước khi bỏ bước duyệt). Liên hệ EWS. |
| 422 | `EMAIL_SUBJECT_REQUIRED` · `EMAIL_SUBJECT_TOO_LONG` · `EMAIL_SUBJECT_INVALID` | gửi, phát | Tiêu đề trống / quá 998 ký tự / có xuống dòng. |
| 422 | `EMAIL_HTML_REQUIRED` · `EMAIL_BODY_TOO_LARGE` | gửi, phát | Thiếu `html` / một phần thân quá 256 KB. Gửi bằng template thì tính trên nội dung đã đổ biến. |
| 422 | `CONTENT_AND_TEMPLATE_CONFLICT` | gửi, phát | Gửi cả `templateId` lẫn `subject` / `html` / `text`. Chọn một cách. |
| 422 | `PAYLOAD_REQUIRES_TEMPLATE` | gửi, phát | Có `payload` mà không có `templateId`. |
| 422 | `TEMPLATE_NOT_FOUND` | gửi, phát | Sai `templateId`, mã của môi trường khác, hoặc template của app khác. |
| 422 | `TEMPLATE_NOT_PUBLISHED` | gửi, phát | Template chưa được xuất bản lần nào. Liên hệ người soạn. |
| 422 | `TEMPLATE_ARCHIVED` | gửi, phát | Template đã lưu trữ, không dùng được nữa. Hỏi người soạn mã mới. |
| 422 | `MISSING_VARIABLE` | gửi, phát | Thiếu biến bắt buộc. `issues` liệt kê **mọi** biến thiếu, `path` là tên biến (`payload.vm_name`). |
| 422 | `INVALID_PAYLOAD_VALUE` | gửi, phát | Giá trị trong `payload` là object, mảng hoặc `null`. |
| 422 | `LINK_SCHEME_NOT_ALLOWED` | gửi, phát | Biến làm link ra địa chỉ không phải `https://` / `mailto:`. |
| 422 | `PAYLOAD_TOO_LARGE` | gửi, phát | `payload` quá 2 KB (khác mã `413` cùng tên — cái này nằm trong `issues`). |
| 422 | `TOPIC_MANDATORY` | preferences | Cố tắt chủ đề bắt buộc. Không có đường lách. |
| 422 | `EMAIL_NOT_SET` | preferences | Đặt `optedOutOptional` cho người chưa có email. |
| 422 | `EMAIL_INVALID` | khai người | Email sai định dạng. |
| 422 | `INVALID_FIELD` | mọi `/v1` | Sai kiểu / thừa trường / mã nhân viên có ký tự lạ. `path` chỉ trường nào. |
| 409 | `EMAIL_TAKEN` | khai người | Địa chỉ đã thuộc người khác trong app. |
| 404 | `NOT_FOUND` | đọc người, preferences, ngắt email, đọc thư, đọc lần phát | Không có (hoặc thuộc app khác). |
| 400 | `MALFORMED_JSON` | mọi `/v1` | Body không phải JSON hợp lệ. |
| 413 | `PAYLOAD_TOO_LARGE` | mọi `/v1` | Request quá lớn (gửi thư, phát: 512 KB; còn lại: 64 KB). |
| 500 | `INTERNAL` | mọi `/v1` | Lỗi phía EWS. |

**Thử lại khi nào:**

* `4xx`: **không** thử lại nguyên xi — gọi lại vẫn sai như thế. Sửa rồi mới gọi.
* `5xx` và hết thời gian chờ: thử lại có giãn cách, **giữ nguyên `idempotencyKey`**.
* MVP **chưa trả `429`** — chưa có hạn mức theo app (mục 9).

---

## 9. Những gì CHƯA có — đừng tìm

| Chưa có | Hệ quả cho app |
| --- | --- |
| Phát cho chủ đề quá 100 người, gửi theo phân khúc | App tự lặp từng người (mục 6, cách 2). |
| App tự tạo / sửa template qua API | Template chỉ soạn và xuất bản trên console EWS. |
| Biến `{{ user.tags.… }}` trong template | Chỉ có `payload.…` và `user.external_id`. |
| Hẹn giờ, huỷ, dừng, gửi lại | Gọi lúc nào thì xếp hàng lúc đó. Thư đã nhận không huỷ được. |
| Xử lý thư dội về | Chính sách "nghỉ việc → ngắt email" (mục 7) là lớp bảo vệ duy nhất. |
| Link "Quản lý thông báo" trong thư | Màn cài đặt của app (bước 4) là cửa duy nhất. |
| Hạn mức theo app (`429`) | Hạn mức lưu theo app chưa được đối chiếu. |
| Webhook báo "lần phát đã xong" / "đã vào hộp thư" / "đã mở" | Đếm sự kiện theo `publicationId` hoặc gọi `GET /v1/publications/:id`; Microsoft không báo hai thứ sau. |
| Kênh khác email | Chỉ email. |

---

## 10. Tra cứu phía EWS

Nhân viên báo "không nhận được thư": gửi đội EWS **mã nhân viên** và **mã lá thư** (`id` trả về
lúc gửi). Người trực EWS tra trên trang quản trị `https://ews-astrolink.eonsr.net` (chỉ đội EWS
đăng nhập được — đội app không dùng địa chỉ này), không cần hỏi lại:

* **Màn Người nhận** — người này có email chưa, đã tắt chủ đề nào, có bị ngắt không.
* **Màn Lịch sử gửi** — từng lá thư gửi người này ra sao, lúc nào, bị chặn vì đâu.
