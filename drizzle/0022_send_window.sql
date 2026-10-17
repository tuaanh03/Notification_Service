ALTER TABLE `apps` ADD `send_window` json;--> statement-breakpoint
ALTER TABLE `apps` ADD `mandatory_bypass_window` boolean DEFAULT true NOT NULL;