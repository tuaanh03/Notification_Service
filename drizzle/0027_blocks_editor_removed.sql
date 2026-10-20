-- ADR-0037 (UX-4, deploy 2): gỡ kiểu soạn `blocks`. CHẠY SAU khi `admin-cli purge-blocks-templates --apply` đã dọn hết.
-- Còn dòng `editor = 'blocks'` thì DỪNG NGAY ở câu đầu với lỗi nêu đúng việc phải làm (tên ràng buộc chính là lời
-- nhắn: "Check constraint 'chk_no_blocks_left__run_admin_cli_purge_blocks_templates_apply' is violated"), chưa đổi
-- gì — không để MODIFY ENUM tự cắt dữ liệu hay báo "Data truncated" khó hiểu. Ràng buộc chỉ dùng để kiểm, gỡ ngay sau đó.
ALTER TABLE `template_versions` ADD CONSTRAINT `chk_no_blocks_left__run_admin_cli_purge_blocks_templates_apply` CHECK (`editor` <> 'blocks');--> statement-breakpoint
ALTER TABLE `template_versions` DROP CHECK `chk_no_blocks_left__run_admin_cli_purge_blocks_templates_apply`;--> statement-breakpoint
ALTER TABLE `template_versions` MODIFY COLUMN `editor` enum('html','visual') NOT NULL DEFAULT 'html';--> statement-breakpoint
-- Cờ bộ soạn trực quan đã gỡ khỏi danh mục cài đặt ở deploy 1 (ADR-0037 §2.2); dòng cũ (nếu Super Admin từng gạt) bỏ đi.
DELETE FROM `system_settings` WHERE `setting_key` = 'templates.visual_editor_enabled';
