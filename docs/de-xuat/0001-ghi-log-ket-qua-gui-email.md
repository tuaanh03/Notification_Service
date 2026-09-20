# ĐX-0001 — Ghi log kết quả gửi email, không phụ thuộc provider

**Trạng thái:** chờ duyệt — phát hiện 2026-09-20.
**Phát hiện khi:** chạy thực nghiệm nghiệm thu (`implementation_plan.md` mục 11) với
`EMAIL_PROVIDER=graph`, gửi một email thật. Thư tới hộp thư thành công, nhưng log `worker`
không có dòng nào về lần gửi đó.

## Hiện trạng

Sau một lần gửi **thành công thật**, toàn bộ log của `worker` chỉ có 3 dòng khởi động:

```
{"level":"info","context":"app:delivery","provider":"graph","maxPerMinute":30,"msg":"email provider selected"}
{"level":"info","context":"app:worker","groups":["email-sender","audit-writer"],"msg":"consumers running"}
{"level":"info","context":"app:worker","pid":1,"msg":"started"}
```

Đối chiếu code:

| Nơi | Ghi log gì |
| --- | --- |
| `MockEmailProvider.send` | `logger.info('mock email', { notification_id, to, subject, result })` — **mỗi lần gửi một dòng** |
| `GraphEmailProvider` | chỉ `logger.debug('graph token acquired', …)`; `LOG_LEVEL` mặc định là `info` nên không hiện |
| `emailSenderHandler` (consumer) | không có log nào |
| `DeliverEmailNotification` | có `logger.child('deliver-email')` nhưng chỉ dùng **một** lần, ở mức `warn`, cho trường hợp tranh chấp ("notification finished elsewhere while sending") |

Nghĩa là: **đường gửi giả có log, đường gửi thật thì không.** Đúng cái đường ra production lại
là đường im lặng nhất.

## Hậu quả thật

1. **Không truy được sự cố.** Có người hỏi "thư gửi cho anh A lúc 14h20 đi chưa" — hiện chỉ trả lời
   được nếu biết trước `notification_id` để gọi `GET /v1/notifications/:id`. Không quét được theo
   thời gian, theo app, theo địa chỉ.
2. **Không đo được gì.** Không biết mỗi phút gửi bao nhiêu, tỉ lệ `failed` bao nhiêu, có đang chạm
   trần `maxPerMinute: 30` của ADR-0018 hay không.
3. **Im lặng mơ hồ.** Không có log có thể là "gửi xong ngon" mà cũng có thể là "worker không nhận
   được việc". Người trực không phân biệt được — chính tôi đã tưởng nhầm là lỗi khi thấy log trống.
4. **Lệch giữa dev và production.** Kịch bản chạy bằng `mock` nhìn thấy mọi thứ; chạy thật thì mù.
   Bug chỉ xuất hiện ở đường thật sẽ khó tái hiện.

## Đề xuất

Ghi log ở **tầng use case**, không ở provider — để mọi provider đều được ghi như nhau và
không phải lặp code ở từng adapter.

Cụ thể: thêm **một** dòng `log.info` ở cuối `DeliverEmailNotification.execute`, chạy cho mọi nhánh
của `DeliveryOutcome` (`sent` · `failed` · `no_recipient` · `skipped`). Logger đã có sẵn ở đó, không
cần thêm phụ thuộc mới.

Trường đề nghị có:

| Trường | Vì sao cần |
| --- | --- |
| `notification_id` | nối với `GET /v1/notifications/:id` và với `audit_log` |
| `app_id` | lọc theo phần mềm nào đang gửi |
| `topic` | biết chủ đề nào chạy nhiều / hỏng nhiều |
| `outcome` | `sent` / `failed` / `no_recipient` / `skipped` |
| `provider` + `provider_result` | phân biệt lỗi phía mình và lỗi phía Microsoft |
| `exclusion_reason` | khi `no_recipient`: `opted_out`, email chết… |
| `duration_ms` | phát hiện Graph chậm dần trước khi thành sự cố |

**Không** ghi địa chỉ email đầy đủ, tiêu đề hay nội dung thư vào log — đó là dữ liệu cá nhân, và
log thường được gom về nơi có nhiều người đọc hơn database. Cần đối chiếu thì đi từ
`notification_id`.

## Không nằm trong phạm vi đề xuất này

* Không dựng hệ thống gom log tập trung, không thêm metrics/tracing.
* Không thêm endpoint `/admin/notifications` để console đọc nhật ký gửi — đó là việc riêng, lớn hơn,
  và phải sửa kế hoạch mới làm.
* Không đổi `LOG_LEVEL` mặc định.

## Liên quan

* `implementation_plan.md` mục 11 — kịch bản nghiệm thu, nơi phát hiện.
* ADR-0018 — giới hạn tốc độ gửi của Graph (`maxPerMinute`), thứ sẽ đo được nếu có log.
* ADR-0016 — GĐ 4, thay `MockEmailProvider` bằng Graph.
