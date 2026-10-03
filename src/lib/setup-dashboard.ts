import { env } from 'cloudflare:workers';
import type { Account } from './auth';
import type { SetupProgress } from './setup-guide';

type ProgressRow = { whatsapp: number; courier: number; leads: number; media: number; campaign: number; importing: number };

export async function setupProgress(account: Account): Promise<SetupProgress> {
  const row = await env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM whatsapp_connections WHERE owner_id = ?1 AND status = 'WORKING' AND phone IS NOT NULL) AS whatsapp,
    EXISTS(SELECT 1 FROM courier_credentials WHERE owner_id = ?1 AND encrypted_session IS NOT NULL AND auth_error IS NULL) AS courier,
    EXISTS(SELECT 1 FROM leads l WHERE l.owner_id = ?1 AND EXISTS(
      SELECT 1 FROM shipments s WHERE s.owner_id = l.owner_id AND s.lead_id = l.id
        AND (s.status = 'delivered' OR (s.provider = 'pathao' AND s.status = 'partial')))) AS leads,
    EXISTS(SELECT 1 FROM campaign_assets WHERE owner_id = ?1 AND state = 'ready' AND library_saved = 1) AS media,
    EXISTS(SELECT 1 FROM campaigns WHERE owner_id = ?1 AND is_test = 0 AND sender_phone IS NOT NULL AND launch_status IS NOT NULL) AS campaign,
    EXISTS(SELECT 1 FROM courier_sync_runs WHERE owner_id = ?1 AND status IN ('queued', 'running')) AS importing`)
    .bind(account.id).first<ProgressRow>();
  if (!row) throw new Error('Setup progress is unavailable.');
  return { companyName: account.companyName, whatsapp: Boolean(row.whatsapp), courier: Boolean(row.courier), leads: Boolean(row.leads), media: Boolean(row.media), campaign: Boolean(row.campaign), importing: Boolean(row.importing) };
}
