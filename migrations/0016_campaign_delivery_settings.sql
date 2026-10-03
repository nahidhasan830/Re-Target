CREATE TABLE `campaign_delivery_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`sender_phone` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`actor` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "campaign_delivery_settings_enabled_check" CHECK("campaign_delivery_settings"."enabled" IN (0, 1))
);
