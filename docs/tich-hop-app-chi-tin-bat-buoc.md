# Tích hợp EWS gửi email — app chỉ gửi tin bắt buộc

*Bản rút gọn cho app mà **mọi chủ đề đều bắt buộc** và **không có màn cài đặt thông báo**. App có
chủ đề người nhận tắt được thì dùng tài liệu đầy đủ `huong-dan-tich-hop-cho-doi-app.md`.*

---

## 0. Thông tin của app bạn

| | |
| --- | --- |
| Tên app · mã ngắn | ⟨ĐIỀN: tên app⟩ · `⟨ĐIỀN: slug⟩` |
| Địa chỉ API | `https://api-ews-astrolink.eonsr.net` — dưới đây viết là `$EWS` |
| Khoá API | Đội EWS giao riêng qua ⟨ĐIỀN: kênh giao khoá⟩. **Chỉ hiện một lần**, mất là phải xin khoá mới |
| Giới hạn IP | ⟨ĐIỀN: "Không khai — gọi được từ mọi máy" hoặc danh sách IP đã khai⟩ |
| Liên hệ bên EWS | ⟨ĐIỀN: tên, kênh liên lạc⟩ |

Chủ đề của app (đều **bắt buộc** — người nhận không tắt được):

| Mã chủ đề (`topic`) | Tên | Dùng cho |
| --- | --- | --- |
| `⟨ĐIỀN⟩` | ⟨ĐIỀN⟩ | ⟨ĐIỀN⟩ |

Cần thêm chủ đề thì báo đội EWS — app không tự tạo được.

---

## 1. EWS làm việc thế nào

* **App quyết định gửi cho ai.** EWS không giữ danh sách người nhận; mỗi lời gọi gửi là **một thư
  cho một người**.
* **Mọi chủ đề của bạn đều bắt buộc**, nên thư luôn đi — trừ khi email của người đó **đã bị ngắt**
  (người đã nghỉ, mục 3) hoặc chưa được khai.
* **Gọi gửi xong chưa phải là thư đã đi.** EWS nhận ngay, gửi sau vài giây.

Chỉ dùng `https`. Khoá API để ở máy chủ của app, không đưa vào trình duyệt hay app di động.

---

## 2. Chạy thử 5 phút

Chạy trước khi viết code: qua được là khoá, mạng và chủ đề đã thông. Cần `curl` và `jq`.

```bash
EWS=https://api-ews-astrolink.eonsr.net
read -s -p 'Khoá API: ' KEY; echo
TOPIC='⟨ĐIỀN: mã một chủ đề⟩'
AUTH="Authorization: Bearer $KEY"

# 1. Khoá dùng được? -> "status":"active", "grantedChannels" có "email"
curl -s $EWS/v1/me -H "$AUTH" | jq

# 2. Khai một người thử bằng EMAIL CỦA CHÍNH BẠN (201 lần đầu, 200 các lần sau)
curl -s -X PUT $EWS/v1/users/NV-TEST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"email":"<email của bạn>"}' | jq

# 3. Gửi -> lấy id lá thư
ID=$(jq -n --arg t "$TOPIC" --arg k "thu-$(date +%s)" \
  '{to:{externalId:"NV-TEST"},topic:$t,subject:"EWS chạy thử",html:"<p>EWS chạy thử</p>",idempotencyKey:$k}' \
  | curl -s -X POST $EWS/v1/notifications -H "$AUTH" -H 'Content-Type: application/json' -d @- | jq -r .id)
echo "id: $ID"

# 4. Vài giây sau -> "status":"sent", và thư tới hộp thư của bạn
curl -s $EWS/v1/notifications/$ID -H "$AUTH" | jq

unset KEY AUTH
```

* Thư **đi thật** — luôn dùng email của chính bạn.
* Bước 3 in `id: null` → chạy lại lệnh gửi bỏ phần `| jq -r .id` để xem lỗi, tra mục 5.
* EWS không xoá được người đã khai: mọi lần chạy thử dùng lại đúng mã `NV-TEST`.

---

## 3. Ba việc app phải làm

Mọi lời gọi kèm header `Authorization: Bearer <khoá>`.

### ① Khai người nhận

EWS **không biết ai tồn tại** cho tới khi app khai. Chưa khai mà gửi → `RECIPIENT_NOT_FOUND`.

```http
PUT $EWS/v1/users/NV-01
Content-Type: application/json

{ "email": "an.nguyen@company.com" }
```

* `NV-01` là **mã của chính app bạn** cho người đó: chữ, số và `. _ - : @ |`, không khoảng trắng,
  tối đa 255 ký tự.
* Tạo mới → `201`, đã có → `200`. Gọi lại bao nhiêu lần cũng được.
* Gọi **lúc bắt đầu** (cho mọi người hiện có), **khi có người mới**, và **khi ai đổi email**.
* Một email chỉ thuộc một người trong app — trùng thì `409 EMAIL_TAKEN`.
* **Không cấp lại mã của người đã nghỉ cho người mới** — người mới sẽ thừa kế email đã bị ngắt và
  không nhận được gì.

### ② Có người nghỉ → ngắt email ngay

```http
DELETE $EWS/v1/users/NV-01/email
```

* Từ lúc này **không thư nào** tới người đó, kể cả tin bắt buộc.
* EWS không nối với hệ thống nhân sự, **không tự biết ai đã nghỉ**. Không gọi thì thư vẫn gửi vào
  hộp thư đã đóng — làm hỏng uy tín hộp thư gửi chung của cả công ty.
* Người đó quay lại: gọi lại `PUT` ở ① với **đúng địa chỉ cũ** là email được bật lại. Khai địa chỉ
  khác thì email được đổi nhưng **vẫn bị ngắt**.

### ③ Gửi thư

```http
POST $EWS/v1/notifications
Content-Type: application/json

{
  "to": { "externalId": "NV-01" },
  "topic": "⟨mã chủ đề⟩",
  "subject": "Cảnh báo đăng nhập lạ",
  "html": "<p>Tài khoản của bạn vừa đăng nhập từ thiết bị mới.</p>",
  "text": "Tài khoản của bạn vừa đăng nhập từ thiết bị mới.",
  "idempotencyKey": "canh-bao-dang-nhap-EV12345-NV-01"
}
```

* **`202` = EWS đã nhận, chưa gửi.** Giữ lại `id` trong kết quả để tra khi cần (mục 4).
* `subject` bắt buộc, không xuống dòng, tối đa 998 ký tự. `html` bắt buộc. `text` tuỳ chọn, nên có.
  Mỗi phần thân tối đa 256 KB.
* Gửi cho nhiều người = gọi nhiều lần, mỗi người một lần.

**Hoặc gửi bằng template** do người soạn làm sẵn trên console EWS — app không gửi `subject` /
`html` / `text` nữa, chỉ gửi mã template và dữ liệu để đổ vào:

```json
{ "to": { "externalId": "NV-01" }, "topic": "⟨mã chủ đề⟩",
  "templateId": "⟨mã template⟩", "payload": { "thiet_bi": "iPhone 15" },
  "idempotencyKey": "canh-bao-dang-nhap-EV12345-NV-01" }
```

* Một trong hai cách cho mỗi lần gọi, không trộn. EWS luôn dùng bản template **đang xuất bản**.
* `payload` tối đa 2 KB; giá trị là chữ, số, `true` / `false`. Khoá template không dùng bị bỏ qua.
* **Mã template khác nhau giữa máy thử và máy thật** — để trong cấu hình theo môi trường, cạnh khoá.
* Người soạn thêm biến bắt buộc mới thì app phải gửi thêm biến đó, không thì bị `MISSING_VARIABLE`.
* Chi tiết đầy đủ: `huong-dan-tich-hop-cho-doi-app.md`, bước 5 — cách 2.

**`idempotencyKey` — luôn gửi kèm.** Mạng lỗi, bạn gọi lại: cùng khoá thì EWS trả `200` kèm thư cũ,
**không gửi lần hai**. Không có khoá thì mỗi lần gọi lại là một thư trùng.

* **Khoá dùng một lần là mất vĩnh viễn.** EWS không so nội dung: gặp lại khoá cũ — dù sau một tháng
  — là trả thư cũ, **thư mới không đi**, không báo lỗi.
* Khoá phải đại diện cho *"lá thư này, cho người này"*: ghép **mã sự kiện** bên app với **mã người
  nhận**.

| Khoá | |
| --- | --- |
| `canh-bao-dang-nhap-EV12345-NV-01` | **Đúng** — mỗi sự kiện một khoá, gọi lại vẫn cùng khoá |
| `bao-cao-2026-09-NV-01` | **Đúng** — báo cáo định kỳ ghép kỳ báo cáo |
| `canh-bao-dang-nhap-NV-01` | **Sai** — lần cảnh báo thứ hai trở đi bị nuốt |
| Chuỗi ngẫu nhiên sinh mới **mỗi lần gọi** | **Sai** — gọi lại khi lỗi mạng thành thư trùng |

---

## 4. Biết thư đã đi chưa

Không cần hỏi sau mỗi lần gửi. Tra khi cần — ví dụ khi có người báo không nhận được thư:

```http
GET $EWS/v1/notifications/<id>
```

| `status` | Nghĩa |
| --- | --- |
| `queued` · `sending` | Đang chờ / đang gửi |
| `sent` | Máy chủ thư **đã nhận** — thường vào hộp thư sau vài giây; không thấy thì xem mục rác |
| `no_recipient` | **Không gửi**, lý do ở `recipient.exclusionReason` (dưới) |
| `failed` | Gửi không được, lý do ở `recipient.error` |

| `exclusionReason` | Nghĩa · làm gì |
| --- | --- |
| `suppressed` | Email đã bị ngắt (②). Nếu người đó vẫn đang làm: khai lại đúng địa chỉ cũ |
| `no_channel` | Người này chưa có email — khai email (①) |
| `invalid` | Địa chỉ không dùng được — báo đội EWS |

**`failed` với `error` bắt đầu bằng `outcome_unknown`**: máy chủ thư không trả lời kịp, **không biết
thư đã đi hay chưa**. EWS không tự gửi lại để tránh thư trùng. Cần gửi lại thì gọi gửi mới với
**khoá mới**, chấp nhận người nhận có thể nhận hai thư.

---

## 5. Lỗi thường gặp

Lỗi luôn là JSON có `code`. **Xử lý theo `code`**, không theo câu chữ. Lỗi `422` có mã thật nằm
trong `issues[0].code` (ngoài cùng chỉ là `VALIDATION`):

```json
{ "status": 422, "code": "VALIDATION", "detail": "…",
  "issues": [{ "code": "RECIPIENT_NOT_FOUND", "message": "…", "path": "to.externalId" }] }
```

| HTTP | Mã | Nghĩa · làm gì |
| --- | --- | --- |
| 401 | `API_KEY_REQUIRED` · `INVALID_API_KEY` | Thiếu khoá / khoá sai hoặc đã thu hồi. Xin khoá mới |
| 403 | `APP_NOT_ACTIVE` | App đang bị tạm ngưng. Liên hệ EWS |
| 403 | `IP_NOT_ALLOWED` | Máy gọi không nằm trong danh sách IP đã khai. Báo EWS thêm IP |
| 422 | `RECIPIENT_NOT_FOUND` | Chưa khai người này — làm ① rồi gửi lại |
| 422 | `TOPIC_NOT_FOUND` · `TOPIC_NOT_ACTIVE` | Sai mã chủ đề / chủ đề đang tạm ngưng |
| 422 | `EMAIL_SUBJECT_REQUIRED` · `EMAIL_SUBJECT_TOO_LONG` · `EMAIL_SUBJECT_INVALID` | Tiêu đề trống / quá dài / có xuống dòng |
| 422 | `EMAIL_HTML_REQUIRED` · `EMAIL_BODY_TOO_LARGE` | Thiếu `html` / nội dung quá 256 KB |
| 422 | `TEMPLATE_NOT_FOUND` · `TEMPLATE_NOT_PUBLISHED` · `TEMPLATE_ARCHIVED` | Sai mã template (hoặc mã của môi trường khác) / chưa xuất bản / đã lưu trữ |
| 422 | `MISSING_VARIABLE` · `INVALID_PAYLOAD_VALUE` | Thiếu biến bắt buộc (`issues` liệt kê đủ) / giá trị là object, mảng, `null` |
| 422 | `CONTENT_AND_TEMPLATE_CONFLICT` · `PAYLOAD_REQUIRES_TEMPLATE` | Trộn hai cách gửi / có `payload` mà không có `templateId` |
| 422 | `LINK_SCHEME_NOT_ALLOWED` | Dữ liệu đổ vào link không phải `https://` / `mailto:` |
| 422 | `EMAIL_INVALID` | Email sai định dạng |
| 422 | `INVALID_FIELD` | Sai kiểu, thừa trường, mã người nhận có ký tự lạ — `path` chỉ trường nào |
| 409 | `EMAIL_TAKEN` | Email đã thuộc người khác trong app |
| 404 | `NOT_FOUND` | Không có người / lá thư này |

**Thử lại khi nào:** `4xx` — sửa rồi mới gọi, gọi lại nguyên xi vẫn sai. `5xx` hoặc hết thời gian
chờ — thử lại có giãn cách, **giữ nguyên `idempotencyKey`**.

---

## 6. Chưa có

Hẹn giờ gửi · huỷ thư đã gửi · tệp đính kèm · EWS gọi ngược báo kết quả (webhook). Gọi lúc nào
gửi lúc đó, cần kết quả thì hỏi (mục 4).

---

## 7. Nghiệm thu và báo sự cố

Trước khi chạy thật, tự kiểm và báo đội EWS kết quả:

- [ ] Mọi người nhận đã được khai (đội EWS đối chiếu số người bên EWS).
- [ ] Cho một người thử nghỉ (②) rồi gửi → `no_recipient` / `suppressed`. Sau đó khai lại để bật lại.
- [ ] Gọi gửi hai lần cùng `idempotencyKey` → lần hai trả `200`, hộp thư chỉ có **một** thư.
- [ ] Gửi đội EWS xem một thư thật: tiêu đề, nội dung, đúng chủ đề.

Có người báo không nhận được thư: gửi đội EWS **mã người nhận** và **`id` lá thư**.

---

## Phụ lục: dữ liệu trả về

`GET /v1/me`

```json
{
  "appId": "…", "orgId": "…", "slug": "⟨slug⟩", "name": "⟨tên app⟩",
  "status": "active", "grantedChannels": ["email"],
  "rateLimitPerMinute": 60, "maxRecipientsPerEvent": 1000
}
```

Hai trường cuối là hạn mức ghi lúc duyệt app, **hiện chưa áp dụng** — bỏ qua.

`PUT /v1/users/:externalId` (cũng là khuôn của `GET /v1/users/:externalId` và `DELETE .../email`)

```json
{
  "userId": "…", "externalId": "NV-01", "createdAt": "2026-09-24T03:00:00.000Z",
  "email": { "address": "an.nguyen@company.com", "status": "active",
             "suppressedReason": null, "optedOutOptional": false }
}
```

Sau `DELETE .../email`: `"status": "unsubscribed"`, `"suppressedReason": "user_unsubscribe"`.

`POST /v1/notifications` → `202` (và `200` khi trùng khoá — kèm thư cũ, có thể đã có `recipient`)

```json
{
  "id": "…", "status": "queued", "topic": "⟨mã chủ đề⟩", "template": null,
  "idempotencyKey": "canh-bao-dang-nhap-EV12345-NV-01", "recipient": null,
  "createdAt": "2026-09-24T03:00:00.000Z", "queuedAt": "2026-09-24T03:00:00.000Z",
  "sendingAt": null, "finishedAt": null
}
```

`GET /v1/notifications/:id` — sau khi gửi xong

```json
{
  "id": "…", "status": "sent", "topic": "⟨mã chủ đề⟩", "template": null,
  "idempotencyKey": "canh-bao-dang-nhap-EV12345-NV-01",
  "recipient": { "address": "an.nguyen@company.com", "status": "sent",
                 "exclusionReason": null, "error": null, "sentAt": "2026-09-24T03:00:04.000Z" },
  "createdAt": "2026-09-24T03:00:00.000Z", "queuedAt": "2026-09-24T03:00:00.000Z",
  "sendingAt": "2026-09-24T03:00:03.000Z", "finishedAt": "2026-09-24T03:00:04.000Z"
}
```

`template` là `null` khi gửi nội dung viết thẳng; gửi bằng template thì là `{ "id": "…", "version": 3 }` —
bản đã dùng cho lá thư đó.

Mọi mốc thời gian là ISO 8601, giờ UTC. `…` là mã do EWS sinh.
