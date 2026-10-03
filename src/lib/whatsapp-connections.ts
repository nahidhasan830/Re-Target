import { env } from 'cloudflare:workers';
import type { Account } from './auth';
import { HttpError } from './http';
import { connectWhatsApp, disconnectWhatsApp, localPhone, pairingCode, whatsAppState, type WhatsAppState, listWhatsAppSessions } from './waha';

export function sessionName(account: Account) {
  return account.role === 'admin' ? 'admin' : `business_${account.id.replaceAll('-', '')}`;
}

async function ensureConnection(account: Account) {
  await env.DB.prepare('INSERT INTO whatsapp_connections (owner_id, user_id, session_name) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO NOTHING')
    .bind(account.id, account.role === 'user' ? account.id : null, sessionName(account)).run();
}

async function synchronize(account: Account, state: WhatsAppState) {
  const now = Math.floor(Date.now() / 1000);
  if (state.status === 'WORKING' && account.role === 'user') {
    const admin = await whatsAppState('admin');
    const conflict = state.phone && await env.DB.prepare('SELECT owner_id FROM whatsapp_connections WHERE phone = ? AND owner_id != ?')
      .bind(state.phone, account.id).first();
    if (!state.phone || state.phone === admin.phone || conflict) {
      await disconnectWhatsApp(sessionName(account));
      await env.DB.prepare("UPDATE whatsapp_connections SET phone = NULL, status = 'STOPPED', checked_at = ? WHERE owner_id = ?").bind(now, account.id).run();
      throw new HttpError(409, !state.phone ? 'Connect a Bangladeshi WhatsApp number.' : 'This WhatsApp number already belongs to another account. Connect a different number.');
    }
  }
  // The conditional claim and unique index protect concurrent scans of the same number.
  const result = await env.DB.prepare(`UPDATE whatsapp_connections SET phone = CASE WHEN ? = 'WORKING' THEN ? ELSE phone END, status = ?, checked_at = ?
    WHERE owner_id = ? AND (? != 'WORKING' OR ? IS NULL OR NOT EXISTS (SELECT 1 FROM whatsapp_connections WHERE phone = ? AND owner_id != ?))`)
    .bind(state.status, state.phone, state.status, now, account.id, state.status, state.phone, state.phone, account.id).run();
  if (!result.meta.changes) {
    if (account.role === 'user') await disconnectWhatsApp(sessionName(account));
    throw new HttpError(409, 'This WhatsApp number already belongs to another account. Connect a different number.');
  }
  return state;
}

export async function accountWhatsAppState(account: Account) {
  return withOperation(account, async () => synchronize(account, await whatsAppState(sessionName(account))));
}

async function withOperation<T>(account: Account, work: () => Promise<T>) {
  await ensureConnection(account);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const result = await env.DB.prepare('UPDATE whatsapp_connections SET operation_id = ?, operation_until = ? WHERE owner_id = ? AND operation_until <= ?')
    .bind(id, now + 60, account.id, now).run();
  if (!result.meta.changes) throw new HttpError(409, 'A connection change is in progress. Please wait and try again.');
  try { return await work(); }
  finally {
    await env.DB.prepare('UPDATE whatsapp_connections SET operation_id = NULL, operation_until = 0 WHERE owner_id = ? AND operation_id = ?')
      .bind(account.id, id).run();
  }
}

export function connectAccountWhatsApp(account: Account) {
  return withOperation(account, async () => synchronize(account, await connectWhatsApp(sessionName(account))));
}

export function accountPairingCode(account: Account, phone: string) {
  return withOperation(account, () => pairingCode(sessionName(account), phone));
}

export function disconnectAccountWhatsApp(account: Account) {
  return withOperation(account, async () => {
    await disconnectWhatsApp(sessionName(account));
    await env.DB.prepare("UPDATE whatsapp_connections SET phone = NULL, status = 'STOPPED', checked_at = ? WHERE owner_id = ?")
      .bind(Math.floor(Date.now() / 1000), account.id).run();
    return { status: 'STOPPED', phone: null, qr: null, refreshAfterSeconds: 5 } satisfies WhatsAppState;
  });
}

export async function refreshConnectionStatuses() {
  const sessions = await listWhatsAppSessions();
  const connections = await env.DB.prepare('SELECT owner_id, session_name, phone FROM whatsapp_connections').all<{ owner_id: string; session_name: string; phone: string | null }>();
  const now = Math.floor(Date.now() / 1000);
  const updates = connections.results.map((connection) => {
    const session = sessions.find((entry) => entry.name === connection.session_name);
    const status = session?.status === 'WORKING'
      ? localPhone(session.me?.id) === connection.phone && connection.phone ? 'WORKING' : 'STARTING'
      : session?.status ?? 'STOPPED';
    return env.DB.prepare('UPDATE whatsapp_connections SET status = ?, checked_at = ? WHERE owner_id = ? AND operation_until <= ?')
      .bind(status, now, connection.owner_id, now);
  });
  if (updates.length) await env.DB.batch(updates);
}
