CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text,
	`phone` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`location` text,
	`excluded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "leads_phone_format" CHECK(length("leads"."phone") = 13 AND "leads"."phone" GLOB '8801[3-9]*' AND "leads"."phone" NOT GLOB '*[^0-9]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_owner_phone` ON `leads` (`owner_id`,`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_owner_id` ON `leads` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`provider` text NOT NULL,
	`shipment_id` text NOT NULL,
	`recipient_name` text,
	`recipient_phone` text,
	`raw_status` text NOT NULL,
	`status` text NOT NULL,
	`delivered_at` integer,
	`source_updated_at` integer,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shipments_provider" CHECK("shipments"."provider" IN ('pathao', 'steadfast')),
	CONSTRAINT "shipments_status" CHECK("shipments"."status" IN ('delivered', 'pending', 'cancelled', 'partial', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_owner_source` ON `shipments` (`owner_id`,`provider`,`shipment_id`);--> statement-breakpoint
CREATE INDEX `shipments_owner_lead` ON `shipments` (`owner_id`,`lead_id`,`status`);