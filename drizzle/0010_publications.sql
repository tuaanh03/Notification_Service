CREATE TABLE `publications` (
	`publication_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`topic_id` char(36) NOT NULL,
	`idempotency_key` varchar(255) NOT NULL,
	`recipient_count` int NOT NULL,
	`template_version_id` char(36),
	`created_by` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `publications_publication_id` PRIMARY KEY(`publication_id`),
	CONSTRAINT `uq_publications_app_idempotency` UNIQUE(`app_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `publication_id` char(36);--> statement-breakpoint
ALTER TABLE `publications` ADD CONSTRAINT `publications_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publications` ADD CONSTRAINT `publications_topic_id_topics_topic_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`topic_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publications` ADD CONSTRAINT `fk_publications_template_version` FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`template_version_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_publication` FOREIGN KEY (`publication_id`) REFERENCES `publications`(`publication_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_notifications_publication` ON `notifications` (`publication_id`);