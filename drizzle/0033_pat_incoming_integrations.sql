CREATE TABLE `personal_access_tokens` (
	`token_id` char(36) NOT NULL,
	`admin_id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`hint` varchar(32) NOT NULL,
	`scope` enum('read','write') NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3),
	`last_used_ip` varchar(45),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_access_tokens_token_id` PRIMARY KEY(`token_id`),
	CONSTRAINT `uq_pat_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `incoming_hooks` ADD `integration` varchar(32);--> statement-breakpoint
ALTER TABLE `incoming_hooks` ADD `alert_trigger` varchar(16);--> statement-breakpoint
ALTER TABLE `personal_access_tokens` ADD CONSTRAINT `personal_access_tokens_admin_id_admins_admin_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`admin_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_pat_admin` ON `personal_access_tokens` (`admin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pat_expires` ON `personal_access_tokens` (`expires_at`);