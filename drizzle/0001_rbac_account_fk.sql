ALTER TABLE `apps` ADD `account_id` char(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_app_roles` ADD `account_id` char(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD CONSTRAINT `uq_apps_app_account` UNIQUE(`app_id`,`account_id`);--> statement-breakpoint
ALTER TABLE `admins` ADD CONSTRAINT `uq_admins_admin_account` UNIQUE(`admin_id`,`account_id`);--> statement-breakpoint
ALTER TABLE `apps` ADD CONSTRAINT `fk_apps_org_account` FOREIGN KEY (`org_id`,`account_id`) REFERENCES `organizations`(`org_id`,`account_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_app_roles` ADD CONSTRAINT `fk_admin_app_roles_admin_account` FOREIGN KEY (`admin_id`,`account_id`) REFERENCES `admins`(`admin_id`,`account_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_app_roles` ADD CONSTRAINT `fk_admin_app_roles_app_account` FOREIGN KEY (`app_id`,`account_id`) REFERENCES `apps`(`app_id`,`account_id`) ON DELETE no action ON UPDATE no action;