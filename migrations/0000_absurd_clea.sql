CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price_cents` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "products_name_length" CHECK(length(trim("products"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "products_price_range" CHECK("products"."price_cents" BETWEEN 0 AND 2147483647)
);
