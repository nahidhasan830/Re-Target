CREATE TABLE `courier_credentials` (
	`owner_id` text NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `provider`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "courier_provider" CHECK("courier_credentials"."provider" IN ('pathao', 'steadfast'))
);
