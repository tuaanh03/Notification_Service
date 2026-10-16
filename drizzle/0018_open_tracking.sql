ALTER TABLE `apps` ADD `track_opens` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD `first_opened_at` datetime(3);--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD `open_count` int DEFAULT 0 NOT NULL;