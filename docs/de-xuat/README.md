# Đề xuất chờ xử lý

Thư mục này giữ những việc **đã phát hiện nhưng chưa làm**, để không rơi mất giữa các phiên.

Khác với `docs/adr/`: ADR ghi quyết định **đã chốt**; ở đây là đề xuất **chưa được duyệt**.
Khác với `implementation_plan.md` mục 12: mục đó là lộ trình sau MVP đã thống nhất; ở đây là
việc phát sinh ngoài lộ trình, thường lộ ra lúc vận hành hoặc thực nghiệm.

Quy ước: `NNNN-mo-ta-ngan.md`, đánh số tăng dần, tiếng Việt, kebab-case — giống `docs/adr/`.

Mỗi đề xuất nêu đủ: phát hiện lúc nào, bằng chứng, hậu quả thật, đề xuất làm gì, và
**không** làm gì. Khi được duyệt và làm xong thì ghi kết quả vào chính file đó rồi
chuyển trạng thái, không xoá — để lần sau còn tra được vì sao.

| File | Trạng thái | Tóm tắt |
| --- | --- | --- |
| `0001-ghi-log-ket-qua-gui-email.md` | **xong 2026-09-20** | Gửi email thật qua Graph không để lại dòng log nào |
| `0002-viec-can-lam-de-hoan-thien-mvp.md` | đang làm — Việc 1 + 3 xong | 4 việc còn lại để MVP bàn giao được; máy chủ đã xong, console còn 23 màn hàng mẫu |
| `0003-consent-theo-topic-da-xong-nhung-khong-nhin-thay.md` | chờ duyệt | Gửi theo topic tôn trọng lựa chọn user đã làm đúng và đủ, nhưng không ai xem được; kèm đề xuất điều kiện khi duyệt app |
