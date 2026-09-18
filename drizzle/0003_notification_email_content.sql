ALTER TABLE `notifications` ADD `target_user_id` char(36);--> statement-breakpoint
ALTER TABLE `notifications` ADD `subject` varchar(998);--> statement-breakpoint
ALTER TABLE `notifications` ADD `body_html` mediumtext;--> statement-breakpoint
ALTER TABLE `notifications` ADD `body_text` mediumtext;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_target_user` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;