ALTER TABLE `notification_recipients` MODIFY COLUMN `exclusion_reason` enum('duplicate','no_channel','invalid','suppressed','opted_out_optional','excluded','opted_out','recipient_limit');--> statement-breakpoint
ALTER TABLE `apps` ADD `max_send_per_hour` int;--> statement-breakpoint
ALTER TABLE `apps` ADD `mandatory_bypass_hourly` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `recipient_daily_limit` int;--> statement-breakpoint
ALTER TABLE `apps` ADD `mandatory_bypass_recipient_limit` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `organizations` ADD `deleted_at` datetime(3);