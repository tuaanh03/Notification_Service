# ADR-0010 — Ngoại lệ dependency rule cho các rule consent thuần (`channelGate`, `effectiveOptIn`)

**Trạng thái:** chấp nhận — 2026-09-17.

## Bối cảnh
`src/modules/segments/domain/rules/resolution-pipeline.ts` import hai hàm từ domain của module khác:

| Hàm | Từ | Lớp lọc |
| --- | --- | --- |
| `channelGate` | `subscriptions/domain/rules/subscription-gate.ts` | L0 (kênh còn sống) + L1 (tắt tin không bắt buộc) |
| `effectiveOptIn` | `topics/domain/rules/topic-consent.ts` | L3 (preference theo topic) |

Đây là import xuyên module ở tầng domain, điều mà dependency rule thường cấm.

## Các lựa chọn
1. Chép rule opt-out sang `segments` — hai bản, chắc chắn lệch nhau sau vài tháng.
2. Truyền `gate` vào pipeline như tham số — thêm một tầng gián tiếp chỉ để lách quy tắc.
3. Chấp nhận import.

## Quyết định
Chọn (3). Cả hai file đều là **hàm thuần**: không bảng, không I/O, không truy vấn chéo.
Điều dependency rule thực sự bảo vệ — module này không được đọc/ghi bảng của module kia —
không hề bị vi phạm.

Rule opt-out là nơi dễ code ngược nhất trong hệ thống (`L0` không bao giờ bỏ qua với topic
mandatory, `L1` và `L3` thì có). Viết nó hai lần nguy hiểm hơn nhiều so với một import.

**Bổ sung 2026-09-18:** trước đó pipeline tự viết lại L3 trong khi `effectiveOptIn` không ai gọi
— đúng kiểu trùng lặp mà ADR này sinh ra để tránh. Nay pipeline gọi thẳng `effectiveOptIn`, hàm này
nhận `ConsentTopic` (`mandatory` + `defaultOptedIn`) thay vì cả entity `Topic`. Test
`L3 của pipeline khớp effectiveOptIn trên mọi tổ hợp` giữ cho hai nơi không lệch nhau.

## Giới hạn
Ngoại lệ chỉ áp cho **hai hàm liệt kê ở trên**, và chỉ vì chúng là hàm thuần trong `domain`.
Thêm hàm thứ ba = sửa ADR này, không import lặng lẽ. Import `modules/*/infrastructure` hoặc
`modules/*/application` từ module khác vẫn bị cấm tuyệt đối.
