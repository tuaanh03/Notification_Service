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
| `0001-ghi-log-ket-qua-gui-email.md` | chờ duyệt | Gửi email thật qua Graph không để lại dòng log nào |
