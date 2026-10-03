CREATE TABLE `campaign_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`campaign_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`request_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`campaign_id`) REFERENCES `campaigns`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_actions_ownerId_requestId_unique` ON `campaign_actions` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `campaign_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text,
	`original_name` text NOT NULL,
	`original_key` text NOT NULL,
	`prepared_key` text,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`state` text NOT NULL,
	`width` integer,
	`height` integer,
	`background` text DEFAULT '#ffffff' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_assets_cleanup` ON `campaign_assets` (`state`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_assets_ownerId_id_unique` ON `campaign_assets` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `campaign_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`asset_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`gateway_id` text,
	`error` text,
	`accepted_at` integer,
	`delivered_at` integer,
	`read_at` integer,
	`retry_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`,`asset_id`) REFERENCES `campaign_assets`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`recipient_id`) REFERENCES `campaign_recipients`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`campaign_id`) REFERENCES `campaigns`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_messages_gateway` ON `campaign_messages` (`owner_id`,`gateway_id`);--> statement-breakpoint
CREATE INDEX `campaign_messages_recipient` ON `campaign_messages` (`owner_id`,`recipient_id`,`ordinal`,`status`);--> statement-breakpoint
CREATE INDEX `campaign_messages_due` ON `campaign_messages` (`status`,`due_at`,`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_messages_ownerId_recipientId_ordinal_unique` ON `campaign_messages` (`owner_id`,`recipient_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_messages_ownerId_id_unique` ON `campaign_messages` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `campaign_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text NOT NULL,
	`work_id` text NOT NULL,
	`available_at` integer NOT NULL,
	`dispatch_token` text,
	`dispatch_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`,`campaign_id`) REFERENCES `campaigns`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_outbox_due` ON `campaign_outbox` (`available_at`,`dispatch_until`);--> statement-breakpoint
CREATE TABLE `campaign_parts` (
	`owner_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`asset_id` text,
	PRIMARY KEY(`owner_id`, `campaign_id`, `ordinal`),
	FOREIGN KEY (`owner_id`,`asset_id`) REFERENCES `campaign_assets`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`campaign_id`) REFERENCES `campaigns`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `campaign_provider_verifications` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`sender_phone` text NOT NULL,
	`gateway_version` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`verified_at` integer NOT NULL,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `campaign_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`lead_id` text,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`chat_id` text,
	`evidence_json` text NOT NULL,
	`skip_reason` text,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`prepared` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`budget_date` text,
	`replied_at` integer,
	FOREIGN KEY (`owner_id`,`lead_id`) REFERENCES `leads`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`campaign_id`) REFERENCES `campaigns`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_recipients_campaign` ON `campaign_recipients` (`owner_id`,`campaign_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_recipients_ownerId_campaignId_leadId_unique` ON `campaign_recipients` (`owner_id`,`campaign_id`,`lead_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_recipients_ownerId_id_unique` ON `campaign_recipients` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `campaign_send_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`message_id` text,
	`invitation_id` text,
	`status` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`finished_at` integer,
	`gateway_id` text,
	`error` text,
	`resolution_json` text,
	FOREIGN KEY (`owner_id`,`message_id`) REFERENCES `campaign_messages`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_attempts_sender` ON `campaign_send_attempts` (`owner_id`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `campaign_test_destinations` (
	`owner_id` text NOT NULL,
	`phone` text NOT NULL,
	`chat_id` text,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`evidence_ref` text NOT NULL,
	PRIMARY KEY(`owner_id`, `phone`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`audience_json` text NOT NULL,
	`company_name` text NOT NULL,
	`sender_phone` text,
	`scheduled_at` integer,
	`expires_at` integer,
	`launch_status` text,
	`preparation_cursor` text DEFAULT '' NOT NULL,
	`preparation_done` integer DEFAULT 0 NOT NULL,
	`preparation_token` text,
	`preparation_until` integer DEFAULT 0 NOT NULL,
	`is_test` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaigns_owner` ON `campaigns` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `campaigns_due` ON `campaigns` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_ownerId_id_unique` ON `campaigns` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `lead_contact_state` (
	`owner_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`active_recipient` text,
	`last_contact_at` integer,
	`next_allowed_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `lead_id`),
	FOREIGN KEY (`owner_id`,`lead_id`) REFERENCES `leads`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lead_marketing_permissions` (
	`owner_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`status` text NOT NULL,
	`scope` text DEFAULT 'whatsapp_marketing' NOT NULL,
	`source` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`evidence_ref` text NOT NULL,
	PRIMARY KEY(`owner_id`, `lead_id`),
	FOREIGN KEY (`owner_id`,`lead_id`) REFERENCES `leads`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sender_dispatch_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`session_name` text NOT NULL,
	`phone` text NOT NULL,
	`active_attempt` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_allowed_at` integer DEFAULT 0 NOT NULL,
	`budget_date` text DEFAULT '' NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`pause_reason` text,
	`last_dispatch_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `whatsapp_events` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`session_name` text NOT NULL,
	`event` text NOT NULL,
	`message_id` text,
	`payload_json` text NOT NULL,
	`received_at` integer NOT NULL,
	`matched` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `whatsapp_events_matching` ON `whatsapp_events` (`owner_id`,`matched`,`message_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `courier_sync_completed` ON `courier_sync_runs` (`owner_id`,`provider`,`completed_at`) WHERE "courier_sync_runs"."status" = 'complete';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `leads_import_run` ON `leads` (`owner_id`,`first_import_run_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `leads_pending_whatsapp` ON `leads` (`owner_id`,`whatsapp_check_until`,`created_at`,`id`) WHERE "leads"."whatsapp_exists" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `shipments_unchecked_pathao` ON `shipments` (`owner_id`,`source_account_id`,`shipment_id`) WHERE "shipments"."provider" = 'pathao' AND "shipments"."status" IN ('delivered', 'partial') AND "shipments"."recipient_phone" IS NOT NULL AND "shipments"."delivery_checked_at" IS NULL;
