CREATE INDEX IF NOT EXISTS leads_import_run ON leads (owner_id, first_import_run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_pending_whatsapp ON leads (owner_id, whatsapp_check_until, created_at, id) WHERE whatsapp_exists IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shipments_unchecked_pathao ON shipments (owner_id, source_account_id, shipment_id)
WHERE provider = 'pathao' AND status IN ('delivered', 'partial') AND recipient_phone IS NOT NULL AND delivery_checked_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS courier_sync_completed ON courier_sync_runs (owner_id, provider, completed_at) WHERE status = 'complete';
--> statement-breakpoint
PRAGMA optimize;
