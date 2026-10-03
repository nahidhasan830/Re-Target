CREATE TABLE `admin_accounts` (
	`phone` text PRIMARY KEY NOT NULL,
	`company_name` text DEFAULT 'Re-Target' NOT NULL,
	`password_hash` text,
	`source_credential_version` text,
	CONSTRAINT "admin_company_length" CHECK(length(trim("admin_accounts"."company_name")) BETWEEN 1 AND 120)
);
