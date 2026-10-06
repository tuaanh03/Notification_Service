CREATE TABLE `org_members` (
	`org_id` char(36) NOT NULL,
	`admin_id` char(36) NOT NULL,
	`account_id` char(36) NOT NULL,
	`role` enum('owner','org_admin','member') NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `org_members_org_id_admin_id_pk` PRIMARY KEY(`org_id`,`admin_id`)
);
--> statement-breakpoint
-- RBAC (ADR-0022). Đổi enum theo 3 bước — mở rộng, chuyển dữ liệu, thu hẹp — vì MySQL strict mode
-- từ chối MODIFY khi còn dòng mang giá trị bị bỏ.
-- admin_app_roles: vai 'super_admin' ở cấp app không còn nghĩa (Super Admin là vai hệ thống).
ALTER TABLE `admin_app_roles` MODIFY COLUMN `role` enum('super_admin','app_admin','app_viewer') NOT NULL;--> statement-breakpoint
DELETE FROM `admin_app_roles` WHERE `role` = 'super_admin';--> statement-breakpoint
ALTER TABLE `admin_app_roles` MODIFY COLUMN `role` enum('app_admin','app_viewer') NOT NULL;--> statement-breakpoint
-- admins: MỌI tài khoản đang có lúc chuyển sang RBAC đều thành Super Admin (quyết định khi triển khai,
-- giữ nguyên quyền họ đang có). Người tạo sau mặc định là 'user'.
ALTER TABLE `admins` MODIFY COLUMN `role` enum('super_admin','app_admin','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
UPDATE `admins` SET `role` = 'super_admin';--> statement-breakpoint
ALTER TABLE `admins` MODIFY COLUMN `role` enum('super_admin','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `org_members` ADD CONSTRAINT `fk_org_members_org_account` FOREIGN KEY (`org_id`,`account_id`) REFERENCES `organizations`(`org_id`,`account_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `org_members` ADD CONSTRAINT `fk_org_members_admin_account` FOREIGN KEY (`admin_id`,`account_id`) REFERENCES `admins`(`admin_id`,`account_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_org_members_admin` ON `org_members` (`admin_id`);