CREATE TABLE `courier_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`credential_version` integer NOT NULL,
	`source_account_id` text,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`cursor` text,
	`step` integer DEFAULT 0 NOT NULL,
	`scanned` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`dispatched_at` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "sync_provider" CHECK("courier_sync_runs"."provider" IN ('pathao', 'steadfast')),
	CONSTRAINT "sync_status" CHECK("courier_sync_runs"."status" IN ('queued', 'running', 'complete', 'failed', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courier_sync_active` ON `courier_sync_runs` (`owner_id`,`provider`) WHERE "courier_sync_runs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX `courier_sync_recent` ON `courier_sync_runs` (`owner_id`,`provider`,`started_at`);--> statement-breakpoint
CREATE INDEX `courier_sync_recovery` ON `courier_sync_runs` (`status`,`lease_until`,`dispatched_at`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`lead_id` text,
	`source_account_id` text DEFAULT 'legacy' NOT NULL,
	`recipient_address` text,
	`source_created_at` integer,
	`merchant_order_id` text,
	`tracking_code` text,
	`details_status` text DEFAULT 'complete' NOT NULL,
	`first_import_run_id` text,
	`provider` text NOT NULL,
	`shipment_id` text NOT NULL,
	`recipient_name` text,
	`recipient_phone` text,
	`raw_status` text NOT NULL,
	`status` text NOT NULL,
	`delivered_at` integer,
	`source_updated_at` integer,
	FOREIGN KEY (`owner_id`,`lead_id`) REFERENCES `leads`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shipments_provider" CHECK("__new_shipments"."provider" IN ('pathao', 'steadfast')),
	CONSTRAINT "shipments_status" CHECK("__new_shipments"."status" IN ('delivered', 'pending', 'cancelled', 'partial', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_shipments`("id","owner_id","lead_id","provider","shipment_id","recipient_name","recipient_phone","raw_status","status","delivered_at","source_updated_at")
SELECT "id","owner_id","lead_id","provider","shipment_id","recipient_name","recipient_phone","raw_status","status","delivered_at","source_updated_at" FROM `shipments`;--> statement-breakpoint
DROP TABLE `shipments`;--> statement-breakpoint
ALTER TABLE `__new_shipments` RENAME TO `shipments`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_owner_source` ON `shipments` (`owner_id`,`provider`,`source_account_id`,`shipment_id`);--> statement-breakpoint
CREATE INDEX `shipments_pending_details` ON `shipments` (`owner_id`,`provider`,`source_account_id`,`details_status`);--> statement-breakpoint
CREATE INDEX `shipments_owner_lead` ON `shipments` (`owner_id`,`lead_id`,`status`);--> statement-breakpoint
ALTER TABLE `courier_credentials` ADD `credential_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `courier_credentials` ADD `source_account_id` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `source_created_at` integer;--> statement-breakpoint
ALTER TABLE `leads` ADD `first_import_run_id` text;