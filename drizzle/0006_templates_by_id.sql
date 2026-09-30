-- ADR-0020: template định danh bằng template_id, bỏ `key`; tên không trùng trong app.
-- Thêm unique MỚI trước khi xoá unique cũ: FK `templates.app_id` đang dựa vào index cũ, xoá trước là
-- ER_DROP_INDEX_FK. Có template trùng tên trong một app thì câu đầu hỏng — đổi tên rồi chạy lại.
ALTER TABLE `templates` ADD CONSTRAINT `uq_templates_app_name` UNIQUE(`app_id`,`name`);--> statement-breakpoint
ALTER TABLE `templates` DROP INDEX `uq_templates_app_key`;--> statement-breakpoint
ALTER TABLE `templates` DROP COLUMN `key`;--> statement-breakpoint
ALTER TABLE `template_versions` MODIFY COLUMN `html` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `template_versions` MODIFY COLUMN `text` mediumtext NOT NULL;--> statement-breakpoint
ALTER TABLE `template_versions` ADD `created_by` varchar(64);--> statement-breakpoint
ALTER TABLE `template_versions` ADD `published_by` varchar(64);
