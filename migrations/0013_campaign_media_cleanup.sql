CREATE TABLE `campaign_media_cleanup` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`original_key` text NOT NULL,
	`prepared_key` text
);
