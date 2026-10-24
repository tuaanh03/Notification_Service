ALTER TABLE `notification_recipients` ADD `last_opened_at` datetime(3);--> statement-breakpoint
-- Thư mới mở đúng một lần: lần cuối chính là lần đầu. Mở >= 2 lần thì không biết lần cuối -> để NULL, không đoán.
UPDATE `notification_recipients` SET `last_opened_at` = `first_opened_at` WHERE `first_opened_at` IS NOT NULL AND `open_count` = 1;
