CREATE TABLE `webhook_deliveries` (
	`delivery_id` char(36) NOT NULL,
	`endpoint_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`event_id` varchar(64) NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`body` text NOT NULL,
	`status` enum('pending','delivered','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3),
	`last_status_code` int,
	`last_error` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`delivered_at` datetime(3),
	CONSTRAINT `webhook_deliveries_delivery_id` PRIMARY KEY(`delivery_id`),
	CONSTRAINT `uq_webhook_deliveries_endpoint_event` UNIQUE(`endpoint_id`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`endpoint_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`slot` tinyint NOT NULL,
	`url` varchar(2048) NOT NULL,
	`events` json NOT NULL,
	`secret_version` int NOT NULL DEFAULT 1,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_by` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `webhook_endpoints_endpoint_id` PRIMARY KEY(`endpoint_id`),
	CONSTRAINT `uq_webhook_endpoints_app_slot` UNIQUE(`app_id`,`slot`)
);
--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `fk_webhook_deliveries_endpoint` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`endpoint_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `fk_webhook_deliveries_app` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `webhook_endpoints_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_due` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_endpoint_created` ON `webhook_deliveries` (`endpoint_id`,`created_at`);