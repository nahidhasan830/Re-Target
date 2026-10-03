import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { checkWhatsAppNumber, whatsAppState } from './waha';

export const whatsAppCheckMessage = z.object({ kind: z.literal('whatsapp'), ownerId: z.union([z.literal('admin'), z.uuid()]) }).strict();
const qualifies = "EXISTS (SELECT 1 FROM shipments s WHERE s.owner_id = leads.owner_id AND s.lead_id = leads.id AND (s.status = 'delivered' OR (s.provider = 'pathao' AND s.status = 'partial')))";
const activeOwner = "(owner_id = 'admin' OR EXISTS (SELECT 1 FROM users u WHERE u.id = owner_id AND u.active = 1))";
const pending = `whatsapp_exists IS NULL AND whatsapp_check_until <= unixepoch() AND ${qualifies} AND ${activeOwner}`;

export async function enqueueWhatsAppChecks(ownerId: string) {
  const lead = await env.DB.prepare(`SELECT id FROM leads INDEXED BY leads_pending_whatsapp WHERE owner_id = ? AND ${pending} LIMIT 1`).bind(ownerId).first();
  if (!lead) return;
  try { await env.LEAD_SYNC.send({ kind: 'whatsapp', ownerId }); }
  catch { /* The scheduled sweep recovers missed dispatches. */ }
}

export async function processWhatsAppChecks(ownerId: string) {
  if(await env.DB.prepare('SELECT owner_id FROM sender_dispatch_state WHERE owner_id=? AND active_attempt IS NOT NULL').bind(ownerId).first()) return;
  const eligible = await env.DB.prepare(`SELECT id FROM leads INDEXED BY leads_pending_whatsapp WHERE owner_id = ? AND ${pending} LIMIT 1`).bind(ownerId).first();
  if (!eligible) return;
  const session = ownerId === 'admin' ? 'admin' : `business_${ownerId.replaceAll('-', '')}`;
  if ((await whatsAppState(session)).status !== 'WORKING') return;
  const leaseUntil = Math.floor(Date.now() / 1000) + 120;
  const rows = await env.DB.prepare(`UPDATE leads SET whatsapp_check_until = ? WHERE id IN
    (SELECT id FROM leads INDEXED BY leads_pending_whatsapp WHERE owner_id = ? AND ${pending} ORDER BY created_at, id LIMIT 5)
    RETURNING id, phone`).bind(leaseUntil, ownerId).all<{ id: string; phone: string }>();
  for (const row of rows.results) {
    try {
      const result = await checkWhatsAppNumber(session, row.phone);
      await env.DB.prepare(`UPDATE leads SET whatsapp_exists = ?, whatsapp_chat_id = ?, whatsapp_checked_at = unixepoch(), whatsapp_check_until = 0
        WHERE owner_id = ? AND id = ? AND whatsapp_check_until = ? AND ${activeOwner}`)
        .bind(Number(result.exists), result.chatId, ownerId, row.id, leaseUntil).run();
    } catch {
      await env.DB.prepare('UPDATE leads SET whatsapp_check_until = unixepoch() + 300 WHERE owner_id = ? AND id = ? AND whatsapp_check_until = ?')
        .bind(ownerId, row.id, leaseUntil).run();
    }
  }
  await enqueueWhatsAppChecks(ownerId);
}

export async function recoverWhatsAppChecks() {
  const owners = await env.DB.prepare(`SELECT DISTINCT owner_id FROM leads INDEXED BY leads_pending_whatsapp WHERE ${pending} LIMIT 100`).all<{ owner_id: string }>();
  for (const owner of owners.results) {
    try { await env.LEAD_SYNC.send({ kind: 'whatsapp', ownerId: owner.owner_id }); }
    catch { /* Retry during the next sweep. */ }
  }
}
