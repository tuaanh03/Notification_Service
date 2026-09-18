CREATE TABLE `app_network_rules` (
	`app_id` char(36) NOT NULL,
	`kind` enum('ip','origin') NOT NULL,
	`value` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `app_network_rules_app_id_kind_value_pk` PRIMARY KEY(`app_id`,`kind`,`value`)
);
--> statement-breakpoint
CREATE TABLE `app_secrets` (
	`app_secret_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`secret_hash` varchar(255) NOT NULL,
	`hint` varchar(64) NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`rotated_at` datetime(3),
	`revoked_at` datetime(3),
	CONSTRAINT `app_secrets_app_secret_id` PRIMARY KEY(`app_secret_id`),
	CONSTRAINT `uq_app_secrets_app_hint` UNIQUE(`app_id`,`hint`)
);
--> statement-breakpoint
CREATE TABLE `apps` (
	`app_id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`name` varchar(200) NOT NULL,
	`namespace` varchar(120) NOT NULL,
	`status` enum('draft','pending_approval','active','suspended','revoked') NOT NULL DEFAULT 'draft',
	`origin` enum('internal','external') NOT NULL DEFAULT 'internal',
	`granted_channels` json NOT NULL DEFAULT ('[]'),
	`rate_limit_per_minute` int NOT NULL DEFAULT 60,
	`max_recipients_per_event` int NOT NULL DEFAULT 1000,
	`included_in_org_broadcast` boolean NOT NULL DEFAULT true,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `apps_app_id` PRIMARY KEY(`app_id`),
	CONSTRAINT `uq_apps_org_slug` UNIQUE(`org_id`,`slug`),
	CONSTRAINT `uq_apps_org_namespace` UNIQUE(`org_id`,`namespace`),
	CONSTRAINT `uq_apps_app_org` UNIQUE(`app_id`,`org_id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`audit_id` char(36) NOT NULL,
	`actor` varchar(64) NOT NULL,
	`actor_type` enum('admin','app','user','system') NOT NULL,
	`action` varchar(96) NOT NULL,
	`target_type` varchar(64) NOT NULL,
	`target_id` varchar(64) NOT NULL,
	`before_data` json,
	`after_data` json,
	`source` varchar(64) NOT NULL,
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_log_audit_id` PRIMARY KEY(`audit_id`)
);
--> statement-breakpoint
CREATE TABLE `bounce_events` (
	`bounce_event_id` char(36) NOT NULL,
	`provider_id` varchar(255) NOT NULL,
	`address` varchar(512) NOT NULL,
	`kind` enum('hard','soft') NOT NULL,
	`raw` json NOT NULL DEFAULT ('{}'),
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `bounce_events_bounce_event_id` PRIMARY KEY(`bounce_event_id`)
);
--> statement-breakpoint
CREATE TABLE `delivery_batches` (
	`delivery_batch_id` char(36) NOT NULL,
	`notification_id` char(36) NOT NULL,
	`batch_no` int NOT NULL,
	`channel` enum('email','sms','push','in_app') NOT NULL,
	`size` int NOT NULL,
	`status` enum('pending','sending','done','failed','skipped') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `delivery_batches_delivery_batch_id` PRIMARY KEY(`delivery_batch_id`),
	CONSTRAINT `uq_delivery_batches_notification_batch` UNIQUE(`notification_id`,`batch_no`)
);
--> statement-breakpoint
CREATE TABLE `person_merge_log` (
	`log_id` char(36) NOT NULL,
	`person_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`matched_on` enum('email','phone','admin_manual') NOT NULL,
	`matched_value` varchar(320) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `person_merge_log_log_id` PRIMARY KEY(`log_id`)
);
--> statement-breakpoint
CREATE TABLE `persons` (
	`person_id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`primary_email` varchar(320) NOT NULL,
	`primary_phone` varchar(32),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `persons_person_id` PRIMARY KEY(`person_id`),
	CONSTRAINT `uq_persons_org_email` UNIQUE(`org_id`,`primary_email`),
	CONSTRAINT `uq_persons_person_org` UNIQUE(`person_id`,`org_id`)
);
--> statement-breakpoint
CREATE TABLE `user_aliases` (
	`user_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`label` varchar(64) NOT NULL,
	`value` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `user_aliases_user_id_label_pk` PRIMARY KEY(`user_id`,`label`),
	CONSTRAINT `uq_user_aliases_app_label_value` UNIQUE(`app_id`,`label`,`value`)
);
--> statement-breakpoint
CREATE TABLE `user_tags` (
	`user_id` char(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` varchar(512) NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `user_tags_user_id_key_pk` PRIMARY KEY(`user_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`external_id` varchar(255),
	`person_id` char(36),
	`source` enum('directory','import','self','api') NOT NULL DEFAULT 'api',
	`last_seen` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `uq_users_app_external` UNIQUE(`app_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `notification_recipients` (
	`notification_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`channel` enum('email','sms','push','in_app') NOT NULL,
	`person_id` char(36),
	`subscription_id` char(36),
	`address` varchar(512) NOT NULL,
	`included_via` varchar(64),
	`exclusion_reason` enum('duplicate','no_channel','invalid','suppressed','opted_out_optional','excluded','opted_out'),
	`batch_no` int,
	`status` enum('pending','sent','bounced','failed','skipped') NOT NULL DEFAULT 'pending',
	`provider_message_id` varchar(255),
	`error` varchar(500),
	`sent_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notification_recipients_notification_id_user_id_channel_pk` PRIMARY KEY(`notification_id`,`user_id`,`channel`)
);
--> statement-breakpoint
CREATE TABLE `notification_transitions` (
	`transition_id` char(36) NOT NULL,
	`notification_id` char(36) NOT NULL,
	`from_status` enum('draft','pending_approval','scheduled','queued','sending','sent','partially_failed','no_recipient','stopped','cancelled','failed') NOT NULL,
	`to_status` enum('draft','pending_approval','scheduled','queued','sending','sent','partially_failed','no_recipient','stopped','cancelled','failed') NOT NULL,
	`event` varchar(64) NOT NULL,
	`actor` varchar(64) NOT NULL,
	`actor_type` enum('admin','app','user','system') NOT NULL,
	`reason` varchar(500),
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notification_transitions_transition_id` PRIMARY KEY(`transition_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`notification_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`topic_id` char(36) NOT NULL,
	`origin` enum('api','dashboard') NOT NULL,
	`status` enum('draft','pending_approval','scheduled','queued','sending','sent','partially_failed','no_recipient','stopped','cancelled','failed') NOT NULL,
	`is_test` boolean NOT NULL DEFAULT false,
	`template_version_id` char(36),
	`payload` json NOT NULL DEFAULT ('{}'),
	`included_segments` json NOT NULL DEFAULT ('[]'),
	`excluded_segments` json NOT NULL DEFAULT ('[]'),
	`idempotency_key` varchar(255),
	`collapse_key` varchar(255),
	`occurrence_count` int NOT NULL DEFAULT 1,
	`stale_directory` boolean NOT NULL DEFAULT false,
	`parent_notification_id` char(36),
	`scheduled_at` datetime(3),
	`created_by` varchar(64),
	`approved_by` varchar(64),
	`preview_rendered_at` datetime(3),
	`counters` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`queued_at` datetime(3),
	`sending_at` datetime(3),
	`finished_at` datetime(3),
	CONSTRAINT `notifications_notification_id` PRIMARY KEY(`notification_id`),
	CONSTRAINT `uq_notifications_app_idempotency` UNIQUE(`app_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `send_approvals` (
	`approval_id` char(36) NOT NULL,
	`notification_id` char(36) NOT NULL,
	`estimate` int NOT NULL,
	`author` varchar(64) NOT NULL,
	`reviewer` varchar(64),
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reason` varchar(500),
	`decided_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `send_approvals_approval_id` PRIMARY KEY(`approval_id`)
);
--> statement-breakpoint
CREATE TABLE `segments` (
	`segment_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`filters` json NOT NULL DEFAULT ('[]'),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `segments_segment_id` PRIMARY KEY(`segment_id`),
	CONSTRAINT `uq_segments_app_name` UNIQUE(`app_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`subscription_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`channel` enum('email','sms','push','in_app') NOT NULL,
	`value` varchar(512) NOT NULL,
	`status` enum('active','unsubscribed','invalid') NOT NULL DEFAULT 'active',
	`opted_out_optional` boolean NOT NULL DEFAULT false,
	`opted_out_optional_at` datetime(3),
	`suppressed_reason` enum('user_unsubscribe','hard_bounce','complaint'),
	`suppressed_at` datetime(3),
	`manage_token` char(36) NOT NULL,
	`manage_token_rotated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `subscriptions_subscription_id` PRIMARY KEY(`subscription_id`),
	CONSTRAINT `uq_subscriptions_app_channel_value` UNIQUE(`app_id`,`channel`,`value`),
	CONSTRAINT `uq_subscriptions_manage_token` UNIQUE(`manage_token`)
);
--> statement-breakpoint
CREATE TABLE `template_versions` (
	`template_version_id` char(36) NOT NULL,
	`template_id` char(36) NOT NULL,
	`version` int NOT NULL,
	`status` enum('draft','published','superseded') NOT NULL DEFAULT 'draft',
	`subject` varchar(500) NOT NULL,
	`html` text NOT NULL,
	`text` text NOT NULL,
	`schema` json NOT NULL DEFAULT ('[]'),
	`ai_generated` boolean NOT NULL DEFAULT false,
	`published_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`published_marker` int GENERATED ALWAYS AS ((case when `status` = 'published' then 1 else null end)) STORED,
	CONSTRAINT `template_versions_template_version_id` PRIMARY KEY(`template_version_id`),
	CONSTRAINT `uq_template_versions_template_version` UNIQUE(`template_id`,`version`),
	CONSTRAINT `uq_template_versions_one_published` UNIQUE(`template_id`,`published_marker`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`template_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`name` varchar(200) NOT NULL,
	`channel` enum('email','sms','push','in_app') NOT NULL,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `templates_template_id` PRIMARY KEY(`template_id`),
	CONSTRAINT `uq_templates_app_key` UNIQUE(`app_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`account_id` char(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `accounts_account_id` PRIMARY KEY(`account_id`)
);
--> statement-breakpoint
CREATE TABLE `admin_app_roles` (
	`admin_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`role` enum('super_admin','app_admin') NOT NULL,
	`granted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`revoked_at` datetime(3),
	CONSTRAINT `admin_app_roles_admin_id_app_id_pk` PRIMARY KEY(`admin_id`,`app_id`)
);
--> statement-breakpoint
CREATE TABLE `admins` (
	`admin_id` char(36) NOT NULL,
	`account_id` char(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('super_admin','app_admin') NOT NULL DEFAULT 'app_admin',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admins_admin_id` PRIMARY KEY(`admin_id`),
	CONSTRAINT `uq_admins_account_email` UNIQUE(`account_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`org_id` char(36) NOT NULL,
	`account_id` char(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `organizations_org_id` PRIMARY KEY(`org_id`),
	CONSTRAINT `uq_organizations_org_account` UNIQUE(`org_id`,`account_id`)
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`topic_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`key` varchar(128) NOT NULL,
	`name` varchar(200) NOT NULL,
	`status` enum('draft','active','suspended') NOT NULL DEFAULT 'draft',
	`default_mode` enum('opt_in','opt_out') NOT NULL DEFAULT 'opt_out',
	`mandatory` boolean NOT NULL DEFAULT false,
	`default_channels` json NOT NULL DEFAULT ('[]'),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `topics_topic_id` PRIMARY KEY(`topic_id`),
	CONSTRAINT `uq_topics_app_key` UNIQUE(`app_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `user_topic_preferences` (
	`user_id` char(36) NOT NULL,
	`topic_id` char(36) NOT NULL,
	`opted_in` boolean NOT NULL,
	`source` enum('user_explicit','system_default','admin_override','bulk_opt_out') NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `user_topic_preferences_user_id_topic_id_pk` PRIMARY KEY(`user_id`,`topic_id`)
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`aggregate_type` varchar(64) NOT NULL,
	`aggregate_id` char(36) NOT NULL,
	`event_type` varchar(96) NOT NULL,
	`stream` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`published_at` datetime(3),
	CONSTRAINT `outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processed_messages` (
	`consumer_group` varchar(64) NOT NULL,
	`message_id` varchar(64) NOT NULL,
	`at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `processed_messages_consumer_group_message_id_pk` PRIMARY KEY(`consumer_group`,`message_id`)
);
--> statement-breakpoint
ALTER TABLE `app_network_rules` ADD CONSTRAINT `app_network_rules_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_secrets` ADD CONSTRAINT `app_secrets_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `apps` ADD CONSTRAINT `apps_org_id_organizations_org_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`org_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_batches` ADD CONSTRAINT `fk_delivery_batches_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`notification_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_merge_log` ADD CONSTRAINT `person_merge_log_person_id_persons_person_id_fk` FOREIGN KEY (`person_id`) REFERENCES `persons`(`person_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_merge_log` ADD CONSTRAINT `person_merge_log_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `persons` ADD CONSTRAINT `persons_org_id_organizations_org_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`org_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_aliases` ADD CONSTRAINT `user_aliases_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_aliases` ADD CONSTRAINT `user_aliases_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_tags` ADD CONSTRAINT `user_tags_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `fk_users_app_org` FOREIGN KEY (`app_id`,`org_id`) REFERENCES `apps`(`app_id`,`org_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `fk_users_person_org` FOREIGN KEY (`person_id`,`org_id`) REFERENCES `persons`(`person_id`,`org_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD CONSTRAINT `fk_notification_recipients_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`notification_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipients_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_transitions` ADD CONSTRAINT `fk_notification_transitions_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`notification_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_topic_id_topics_topic_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`topic_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `fk_notifications_template_version` FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`template_version_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `send_approvals` ADD CONSTRAINT `send_approvals_notification_id_notifications_notification_id_fk` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`notification_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `segments` ADD CONSTRAINT `segments_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `template_versions` ADD CONSTRAINT `template_versions_template_id_templates_template_id_fk` FOREIGN KEY (`template_id`) REFERENCES `templates`(`template_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `templates` ADD CONSTRAINT `templates_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_app_roles` ADD CONSTRAINT `admin_app_roles_admin_id_admins_admin_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`admin_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admins` ADD CONSTRAINT `admins_account_id_accounts_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`account_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organizations` ADD CONSTRAINT `organizations_account_id_accounts_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`account_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topics` ADD CONSTRAINT `topics_app_id_apps_app_id_fk` FOREIGN KEY (`app_id`) REFERENCES `apps`(`app_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_topic_preferences` ADD CONSTRAINT `user_topic_preferences_user_id_users_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_topic_preferences` ADD CONSTRAINT `user_topic_preferences_topic_id_topics_topic_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`topic_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_audit_log_target` ON `audit_log` (`target_type`,`target_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_actor` ON `audit_log` (`actor`,`at`);--> statement-breakpoint
CREATE INDEX `idx_bounce_events_address` ON `bounce_events` (`address`);--> statement-breakpoint
CREATE INDEX `idx_person_merge_log_person` ON `person_merge_log` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_users_app` ON `users` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_users_person` ON `users` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_users_org` ON `users` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_notification_recipients_subscription` ON `notification_recipients` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_notification_recipients_batch` ON `notification_recipients` (`notification_id`,`batch_no`);--> statement-breakpoint
CREATE INDEX `idx_notification_transitions_notification` ON `notification_transitions` (`notification_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_app_created` ON `notifications` (`app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_scheduled` ON `notifications` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_send_approvals_notification` ON `send_approvals` (`notification_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_user` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_app_status` ON `subscriptions` (`app_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_outbox_unpublished` ON `outbox` (`published_at`,`id`);