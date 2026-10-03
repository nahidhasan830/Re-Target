CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`delivery_status` text NOT NULL,
	`delivery_error` text,
	`message_id` text,
	`request_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer NOT NULL,
	`accepted_at` integer,
	`user_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_phone_unique` ON `invitations` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_request_id_unique` ON `invitations` (`request_id`);--> statement-breakpoint
CREATE INDEX `invitations_created` ON `invitations` (`created_at`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_sessions_expiry` ON `user_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `user_sessions_user` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`company_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "users_phone_format" CHECK(length("users"."phone") = 11 AND "users"."phone" GLOB '01[0-9]*' AND "users"."phone" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "users_company_length" CHECK(length(trim("users"."company_name")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);--> statement-breakpoint
CREATE TABLE `whatsapp_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`session_name` text NOT NULL,
	`phone` text,
	`status` text DEFAULT 'STOPPED' NOT NULL,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`operation_id` text,
	`operation_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_connections_session_name_unique` ON `whatsapp_connections` (`session_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_connections_phone` ON `whatsapp_connections` (`phone`);