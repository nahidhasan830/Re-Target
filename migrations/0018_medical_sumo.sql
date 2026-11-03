CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`token_hash` text NOT NULL,
	`credential_version` text NOT NULL,
	`expires_at` integer NOT NULL,
	`delivery_status` text NOT NULL,
	`message_id` text,
	`sent_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_phone_unique` ON `password_resets` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
ALTER TABLE `campaign_send_attempts` ADD `password_reset_id` text;