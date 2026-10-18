ALTER TABLE `template_versions` ADD `editor` enum('html','blocks') DEFAULT 'html' NOT NULL;--> statement-breakpoint
ALTER TABLE `template_versions` ADD `design` json;