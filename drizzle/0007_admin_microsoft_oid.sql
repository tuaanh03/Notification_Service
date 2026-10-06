ALTER TABLE `admins` ADD `microsoft_oid` varchar(36);--> statement-breakpoint
ALTER TABLE `admins` ADD CONSTRAINT `uq_admins_microsoft_oid` UNIQUE(`microsoft_oid`);