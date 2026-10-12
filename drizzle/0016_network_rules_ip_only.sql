-- Bỏ luật Origin (bổ sung ADR-0023): xoá dòng origin trước, rồi thu enum về chỉ còn ip.
DELETE FROM `app_network_rules` WHERE `kind` = 'origin';--> statement-breakpoint
ALTER TABLE `app_network_rules` MODIFY COLUMN `kind` enum('ip') NOT NULL;
