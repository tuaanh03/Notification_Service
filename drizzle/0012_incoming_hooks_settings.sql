CREATE TABLE `incoming_calls` (
	`call_id` char(36) NOT NULL,
	`hook_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`http_status` int NOT NULL,
	`outcome` enum('published','duplicate','skipped','rejected') NOT NULL,
	`publication_id` char(36),
	`recipient_count` int,
	`error_code` varchar(64),
	CONSTRAINT `incoming_calls_call_id` PRIMARY KEY(`call_id`)
);
--> statement-breakpoint
CREATE TABLE `incoming_hooks` (
	`hook_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`slot` tinyint NOT NULL,
	`name` varchar(100) NOT NULL,
	`topic_id` char(36) NOT NULL,
	`template_id` char(36) NOT NULL,
	`mappings` json NOT NULL,
	`dedupe_path` varchar(200),
	`publish_condition` json,
	`token_hash` varchar(64) NOT NULL,
	`token_hint` varchar(32) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_by` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `incoming_hooks_hook_id` PRIMARY KEY(`hook_id`),
	CONSTRAINT `uq_incoming_hooks_app_slot` UNIQUE(`app_id`,`slot`),
	CONSTRAINT `uq_incoming_hooks_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`setting_key` varchar(64) NOT NULL,
	`value` json,
	`updated_by` varchar(64),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `system_settings_setting_key` PRIMARY KEY(`setting_key`)
);
--> statement-breakpoint
ALTER TABLE `incoming_calls` ADD CONSTRAINT `fk_incoming_calls_hook` FOREIGN KEY (`hook_id`) REFERENCES `incoming_hooks`(`hook_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incoming_calls` ADD CONSTRAINT `fk_incoming_calls_app` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incoming_calls` ADD CONSTRAINT `fk_incoming_calls_publication` FOREIGN KEY (`publication_id`) REFERENCES `publications`(`publication_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incoming_hooks` ADD CONSTRAINT `incoming_hooks_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incoming_hooks` ADD CONSTRAINT `incoming_hooks_topic_id_topics_topic_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`topic_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incoming_hooks` ADD CONSTRAINT `incoming_hooks_template_id_templates_template_id_fk` FOREIGN KEY (`template_id`) REFERENCES `templates`(`template_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_incoming_calls_hook_at` ON `incoming_calls` (`hook_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_incoming_calls_at` ON `incoming_calls` (`at`);