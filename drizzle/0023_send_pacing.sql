ALTER TABLE `apps` ADD `send_per_minute` int;--> statement-breakpoint
ALTER TABLE `apps` ADD `mandatory_bypass_pacing` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `max_send_per_minute` int;