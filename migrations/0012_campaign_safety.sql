ALTER TABLE `campaigns` ADD `edit_token` text;--> statement-breakpoint
ALTER TABLE `sender_dispatch_state` ADD `active_recipient` text;--> statement-breakpoint
CREATE TRIGGER campaign_parts_ready_insert BEFORE INSERT ON campaign_parts
WHEN NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaign_assets WHERE owner_id=NEW.owner_id AND id=NEW.asset_id AND state='ready')
BEGIN SELECT RAISE(ABORT,'Attachment is not ready'); END;
--> statement-breakpoint
CREATE TRIGGER campaign_messages_ready_insert BEFORE INSERT ON campaign_messages
WHEN NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaign_assets WHERE owner_id=NEW.owner_id AND id=NEW.asset_id AND state='ready')
BEGIN SELECT RAISE(ABORT,'Attachment is not ready'); END;
--> statement-breakpoint
CREATE TRIGGER campaign_messages_ready_update BEFORE UPDATE OF asset_id ON campaign_messages
WHEN NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM campaign_assets WHERE owner_id=NEW.owner_id AND id=NEW.asset_id AND state='ready')
BEGIN SELECT RAISE(ABORT,'Attachment is not ready'); END;
--> statement-breakpoint
CREATE TRIGGER campaign_account_cleanup BEFORE DELETE ON users BEGIN
  INSERT INTO campaign_media_cleanup SELECT id,owner_id,original_key,prepared_key FROM campaign_assets WHERE user_id=OLD.id;
  DELETE FROM campaigns WHERE owner_id=OLD.id;
  DELETE FROM sender_dispatch_state WHERE owner_id=OLD.id;
  DELETE FROM campaign_test_destinations WHERE owner_id=OLD.id;
  DELETE FROM campaign_provider_verifications WHERE owner_id=OLD.id;
  DELETE FROM whatsapp_events WHERE owner_id=OLD.id;
  DELETE FROM campaign_actions WHERE owner_id=OLD.id;
END;
