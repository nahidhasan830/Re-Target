ALTER TABLE leads ADD COLUMN whatsapp_exists INTEGER CHECK (whatsapp_exists IS NULL OR whatsapp_exists IN (0, 1));
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN whatsapp_chat_id TEXT;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN whatsapp_checked_at INTEGER;
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN whatsapp_check_until INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE shipments ADD COLUMN parcel_value_cents INTEGER CHECK (parcel_value_cents IS NULL OR parcel_value_cents >= 0);

--> statement-breakpoint
UPDATE shipments SET details_status = 'pending' WHERE provider = 'steadfast' AND source_account_id != 'legacy';
