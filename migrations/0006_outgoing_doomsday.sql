ALTER TABLE `courier_credentials` ADD `encrypted_session` text;--> statement-breakpoint
ALTER TABLE `courier_credentials` ADD `session_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `courier_credentials` ADD `auth_lock` text;--> statement-breakpoint
ALTER TABLE `courier_credentials` ADD `auth_lock_expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `courier_credentials` ADD `retry_after` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `courier_credentials` ADD `auth_error` text;