ALTER TABLE `campaign_assets` ADD `library_saved` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `campaign_assets_library` ON `campaign_assets` (`owner_id`,`state`,`created_at`,`id`);
--> statement-breakpoint
UPDATE campaign_assets SET library_saved=1 WHERE state='ready';
