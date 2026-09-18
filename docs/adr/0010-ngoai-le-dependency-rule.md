# ADR-0010 — Ngoại lệ dependency rule cho `channelGate`

**Trạng thái:** chấp nhận — 2026-09-17.

## Bối cảnh
`src/modules/segments/domain/resolution-pipeline.ts` import `channelGate` từ
`src/modules/subscriptions/domain/subscription-gate.ts`. Đây là import xuyên module ở tầng domain,
điều mà dependency rule thường cấm.

## Các lựa chọn
1. Chép rule opt-out sang `segments` — hai bản, chắc chắn lệch nhau sau vài tháng.
2. Truyền `gate` vào pipeline như tham số — thêm một tầng gián tiếp chỉ để lách quy tắc.
3. Chấp nhận import.

## Quyết định
Chọn (3). Cả hai file đều là **hàm thuần**: không bảng, không I/O, không truy vấn chéo.
Điều dependency rule thực sự bảo vệ — module này không được đọc/ghi bảng của module kia —
không hề bị vi phạm.

Rule opt-out là nơi dễ code ngược nhất trong hệ thống (`L0` không bao giờ bỏ qua với topic
mandatory, `L1` thì có). Viết nó hai lần nguy hiểm hơn nhiều so với một import.

## Giới hạn
Ngoại lệ chỉ áp cho hàm thuần trong `domain`. Import `modules/*/infrastructure` hoặc
`modules/*/application` từ module khác vẫn bị cấm tuyệt đối.
