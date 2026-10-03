ALTER TABLE `shipments` ADD `source_archive` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shipments` ADD `delivery_checked_at` integer;--> statement-breakpoint
CREATE INDEX `shipments_pending_delivery` ON `shipments` (`owner_id`,`provider`,`source_account_id`,`status`,`delivery_checked_at`);