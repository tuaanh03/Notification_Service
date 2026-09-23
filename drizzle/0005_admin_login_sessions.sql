CREATE TABLE `admin_sessions` (
	`session_id` char(36) NOT NULL,
	`admin_id` char(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_sessions_session_id` PRIMARY KEY(`session_id`),
	CONSTRAINT `uq_admin_sessions_token` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `admins` ADD `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_id_admins_admin_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`admin_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin_sessions_admin` ON `admin_sessions` (`admin_id`);--> statement-breakpoint
CREATE INDEX `idx_admin_sessions_expires` ON `admin_sessions` (`expires_at`);