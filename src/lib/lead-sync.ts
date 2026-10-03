import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { adminCredentials, digest, type Account } from './auth';
import { HttpError } from './http';
import { courierRead, verifyCourier } from './courier-sessions';
import { courierText } from './courier-auth';
import { parsePathao, parsePathaoActivity, pathaoActivityPath, parseSteadfastDetail, parseSteadfastList, pathaoPath, type Parcel } from './courier-parcels';
import { enqueueWhatsAppChecks } from './lead-whatsapp';
import type { CourierProvider } from './courier-validation';

export const syncMessage = z.object({ runId: z.uuid(), step: z.number().int().nonnegative() }).strict();
export type SyncMessage = z.infer<typeof syncMessage>;
type Run = { id: string; owner_id: string; provider: CourierProvider; credential_version: number; source_account_id: string | null; status: string; cursor: string | null; step: number; attempts: number; lease_token: string | null; lease_until: number; };
const now = () => Math.floor(Date.now() / 1000);
const automaticSyncInterval = 12 * 60 * 60;
const active = "status IN ('queued', 'running')";
const guard = `EXISTS (SELECT 1 FROM courier_sync_runs r JOIN courier_credentials c ON c.owner_id = r.owner_id AND c.provider = r.provider
  WHERE r.id = ? AND r.lease_token = ? AND r.status = 'running' AND r.lease_until > unixepoch() AND c.credential_version = r.credential_version
  AND (r.owner_id = 'admin' OR EXISTS (SELECT 1 FROM users u WHERE u.id = r.owner_id AND u.active = 1)))`;

export async function syncStatus(ownerId: string) {
  const result = await env.DB.prepare(`SELECT c.provider, c.encrypted_session IS NOT NULL AS connected, c.auth_error AS authError,
    r.id AS runId, r.status, r.scanned, r.skipped, r.error, r.started_at AS startedAt, r.updated_at AS updatedAt,
    (SELECT MAX(completed_at) FROM courier_sync_runs WHERE owner_id = c.owner_id AND provider = c.provider AND status = 'complete') AS lastSuccess,
    (SELECT COUNT(*) FROM leads WHERE owner_id = c.owner_id AND first_import_run_id = r.id) AS newLeads,
    (SELECT COUNT(*) FROM shipments WHERE owner_id = c.owner_id AND provider = c.provider AND source_account_id = r.source_account_id
      AND details_status = 'pending') +
    (SELECT COUNT(*) FROM shipments INDEXED BY shipments_unchecked_pathao WHERE owner_id = c.owner_id AND provider = c.provider AND source_account_id = r.source_account_id
      AND provider = 'pathao' AND status IN ('delivered', 'partial') AND recipient_phone IS NOT NULL AND delivery_checked_at IS NULL AND details_status != 'pending') AS pending
    FROM courier_credentials c LEFT JOIN courier_sync_runs r ON r.id = (SELECT id FROM courier_sync_runs WHERE owner_id = c.owner_id AND provider = c.provider ORDER BY started_at DESC, rowid DESC LIMIT 1)
    WHERE c.owner_id = ?`).bind(ownerId).all<{ provider: CourierProvider; connected: number; authError: string | null; runId: string | null; status: string | null; scanned: number | null; skipped: number | null; error: string | null; startedAt: number | null; updatedAt: number | null; lastSuccess: number | null; newLeads: number; pending: number }>();
  return (['pathao', 'steadfast'] as const).map(provider => {
    const row = result.results.find(row => row.provider === provider);
    return { provider, configured: Boolean(row), connected: Boolean(row?.connected) && !row?.authError, syncAvailable: Boolean(row?.connected) && !row?.authError,
      runId: row?.runId ?? null, status: row?.status ?? 'idle', scanned: row?.scanned ?? 0, newLeads: row?.newLeads ?? 0, pending: row?.pending ?? 0,
      skipped: row?.skipped ?? 0, error: row?.authError ?? row?.error ?? null, lastSuccess: row?.lastSuccess ?? null, updatedAt: row?.updatedAt ?? null };
  });
}
async function accountForOwner(ownerId: string): Promise<Account | null> {
  if (ownerId === 'admin') { const admin = await adminCredentials(); return { role: 'admin', id: 'admin', phone: admin.phone, companyName: admin.companyName, credentialVersion: await digest(admin.hash) }; }
  const user = await env.DB.prepare('SELECT id, phone, company_name AS companyName, credential_version AS credentialVersion FROM users WHERE id = ? AND active = 1').bind(ownerId).first<{ id: string; phone: string; companyName: string; credentialVersion: number }>();
  return user ? { ...user, role: 'user' } : null;
}
async function dispatch(run: { id: string; step: number }, delaySeconds = 0) {
  try {
    await env.LEAD_SYNC.send({ runId: run.id, step: run.step }, { delaySeconds });
    await env.DB.prepare(`UPDATE courier_sync_runs SET dispatched_at = ? WHERE id = ? AND step = ? AND ${active}`).bind(now(), run.id, run.step).run();
  } catch {
    await env.DB.prepare(`UPDATE courier_sync_runs SET error = 'Import is queued; background delivery will retry.' WHERE id = ? AND step = ? AND ${active}`).bind(run.id, run.step).run();
  }
}
export async function startSync(account: Account, provider: CourierProvider, trigger: 'connect' | 'manual' | 'scheduled' = 'manual') {
  const credentials = await env.DB.prepare('SELECT credential_version, encrypted_session, auth_error FROM courier_credentials WHERE owner_id = ? AND provider = ?').bind(account.id, provider).first<{ credential_version: number; encrypted_session: string | null; auth_error: string | null }>();
  if (!credentials?.encrypted_session || credentials.auth_error) throw new HttpError(400, `Reconnect ${provider === 'pathao' ? 'Pathao' : 'Steadfast'} in Courier settings to import leads.`);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`UPDATE courier_sync_runs SET status = 'superseded', completed_at = ?, lease_token = NULL, lease_until = 0 WHERE owner_id = ? AND provider = ? AND credential_version != ? AND ${active}`).bind(now(), account.id, provider, credentials.credential_version),
    env.DB.prepare(`INSERT INTO courier_sync_runs (id, owner_id, provider, credential_version, trigger, status, cursor, started_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 'queued', ?, ?, ? WHERE EXISTS (SELECT 1 FROM courier_credentials WHERE owner_id = ? AND provider = ? AND credential_version = ?)
      ON CONFLICT DO NOTHING`).bind(id, account.id, provider, credentials.credential_version, trigger, provider === 'pathao' ? pathaoPath() : '/user/consignment/status/delivered', now(), now(), account.id, provider, credentials.credential_version),
  ]);
  const run = await env.DB.prepare(`SELECT id, step, lease_until, dispatched_at FROM courier_sync_runs WHERE owner_id = ? AND provider = ? AND ${active}`).bind(account.id, provider).first<{ id: string; step: number; lease_until: number; dispatched_at: number }>();
  if (!run) throw new HttpError(409, 'Courier credentials changed. Try connecting again.');
  if (run.lease_until <= now() && run.dispatched_at < now() - 10) await dispatch(run);
  return run.id;
}
async function read(account: Account, provider: CourierProvider, path: string) {
  const response = await courierRead(account, provider, path);
  if (!response.ok) {
    console.error(JSON.stringify({ event: 'courier_parcel_read_failed', provider, status: response.status }));
    await response.body?.cancel();
    throw new HttpError(response.status === 429 ? 429 : 502, response.status === 429 ? 'The courier is limiting requests. The import will retry shortly.' : 'The courier could not provide parcels. The import will retry.');
  }
  return courierText(response, 2 * 1024 * 1024);
}
function statements(run: Run, parcel: Parcel, complete: boolean): D1PreparedStatement[] {
  const qualifies = parcel.status === 'delivered' || (run.provider === 'pathao' && parcel.status === 'partial');
  const values: D1PreparedStatement[] = [];
  if (complete && qualifies && parcel.phone) {
    values.push(env.DB.prepare(`INSERT INTO leads (id, owner_id, user_id, phone, name, location, created_at, source_created_at, first_import_run_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
      ON CONFLICT(owner_id, phone) DO UPDATE SET
        name = CASE WHEN COALESCE(excluded.source_created_at, 0) >= COALESCE(leads.source_created_at, 0) THEN excluded.name ELSE leads.name END,
        location = CASE WHEN COALESCE(excluded.source_created_at, 0) >= COALESCE(leads.source_created_at, 0) THEN excluded.location ELSE leads.location END,
        source_created_at = MAX(COALESCE(leads.source_created_at, 0), COALESCE(excluded.source_created_at, 0))`)
      .bind(crypto.randomUUID(), run.owner_id, run.owner_id === 'admin' ? null : run.owner_id, parcel.phone, parcel.name, parcel.address, now(), parcel.createdAt, run.id, run.id, run.lease_token));
  }
  values.push(env.DB.prepare(`INSERT INTO shipments (id, owner_id, provider, source_account_id, shipment_id, lead_id, recipient_name, recipient_phone, recipient_address, raw_status, status, source_created_at, source_updated_at, delivered_at, merchant_order_id, tracking_code, parcel_value_cents, details_status, first_import_run_id, source_archive)
    SELECT ?, ?, ?, ?, ?, (SELECT id FROM leads WHERE owner_id = ? AND phone = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
    ON CONFLICT(owner_id, provider, source_account_id, shipment_id) DO UPDATE SET
      lead_id = CASE WHEN excluded.details_status = 'complete' THEN excluded.lead_id ELSE shipments.lead_id END,
      recipient_name = excluded.recipient_name, recipient_address = excluded.recipient_address,
      recipient_phone = CASE WHEN excluded.details_status = 'complete' THEN excluded.recipient_phone ELSE shipments.recipient_phone END,
      raw_status = excluded.raw_status, status = excluded.status,
      source_created_at = COALESCE(excluded.source_created_at, shipments.source_created_at), source_updated_at = COALESCE(excluded.source_updated_at, shipments.source_updated_at),
      source_archive = excluded.source_archive,
      delivery_checked_at = CASE WHEN excluded.status IS NOT shipments.status OR (excluded.source_updated_at IS NOT NULL AND excluded.source_updated_at IS NOT shipments.source_updated_at) THEN NULL ELSE shipments.delivery_checked_at END,
      delivered_at = COALESCE(excluded.delivered_at, shipments.delivered_at), merchant_order_id = COALESCE(excluded.merchant_order_id, shipments.merchant_order_id),
      tracking_code = COALESCE(excluded.tracking_code, shipments.tracking_code),
      parcel_value_cents = COALESCE(excluded.parcel_value_cents, shipments.parcel_value_cents),
      details_status = CASE WHEN shipments.details_status = 'complete' THEN 'complete' ELSE excluded.details_status END`)
    .bind(crypto.randomUUID(), run.owner_id, run.provider, run.source_account_id, parcel.shipmentId, run.owner_id, complete && qualifies ? parcel.phone : null,
      parcel.name, parcel.phone, parcel.address, parcel.rawStatus, parcel.status, parcel.createdAt, parcel.statusUpdatedAt, parcel.deliveredAt, parcel.invoice, parcel.trackingCode, parcel.parcelValueCents,
      complete ? 'complete' : 'pending', run.id, parcel.sourceArchive ?? 0, run.id, run.lease_token));
  return values;
}
export async function processSync(message: SyncMessage) {
  const previous = await env.DB.prepare('SELECT * FROM courier_sync_runs WHERE id = ?').bind(message.runId).first<Run>();
  if (!previous || !['queued', 'running'].includes(previous.status) || previous.step !== message.step) return;
  const token = crypto.randomUUID();
  const run = await env.DB.prepare(`UPDATE courier_sync_runs SET status = 'running', lease_token = ?, lease_until = ?, updated_at = ?
    WHERE id = ? AND step = ? AND ${active} AND lease_until <= ? RETURNING *`).bind(token, now() + 180, now(), message.runId, message.step, now()).first<Run>();
  if (!run) throw new HttpError(409, 'Import is already processing.');
  try {
    const account = await accountForOwner(run.owner_id);
    const current = await env.DB.prepare('SELECT credential_version FROM courier_credentials WHERE owner_id = ? AND provider = ?').bind(run.owner_id, run.provider).first<{ credential_version: number }>();
    if (!account || current?.credential_version !== run.credential_version) {
      await env.DB.prepare("UPDATE courier_sync_runs SET status = 'superseded', completed_at = ?, lease_token = NULL, lease_until = 0 WHERE id = ? AND lease_token = ?").bind(now(), run.id, token).run(); return;
    }
    if (!run.source_account_id) {
      const source = await verifyCourier(account, run.provider);
      if (!source) throw new HttpError(502, 'The courier merchant identity could not be verified. Reconnect your account.');
      await env.DB.batch([
        env.DB.prepare(`UPDATE courier_sync_runs SET source_account_id = ? WHERE id = ? AND ${guard}`).bind(source, run.id, run.id, token),
        env.DB.prepare(`UPDATE courier_credentials SET source_account_id = ? WHERE owner_id = ? AND provider = ? AND credential_version = ? AND ${guard}`).bind(source, run.owner_id, run.provider, run.credential_version, run.id, token),
      ]);
      run.source_account_id = source;
    }
    const pending = run.provider === 'steadfast' ? await env.DB.prepare(`SELECT shipment_id AS shipmentId, recipient_name AS name, recipient_address AS address, raw_status AS rawStatus, status, source_created_at AS createdAt, merchant_order_id AS invoice, parcel_value_cents AS parcelValueCents
      FROM shipments WHERE owner_id = ? AND provider = ? AND source_account_id = ? AND details_status = 'pending' ORDER BY shipment_id LIMIT 5`).bind(run.owner_id, run.provider, run.source_account_id).all<Parcel>() : !run.cursor ? await env.DB.prepare(`SELECT shipment_id AS shipmentId, recipient_phone AS phone, source_archive AS sourceArchive, status
      FROM shipments INDEXED BY shipments_unchecked_pathao WHERE owner_id = ? AND provider = 'pathao' AND source_account_id = ? AND status IN ('delivered', 'partial')
      AND recipient_phone IS NOT NULL AND delivery_checked_at IS NULL ORDER BY shipment_id LIMIT 5`).bind(run.owner_id, run.source_account_id).all<Parcel>() : { results: [] };
    const writes: D1PreparedStatement[] = [];
    let cursor = run.cursor, scanned = 0, skipped = 0;
    if (pending.results.length) {
      for (const saved of pending.results) {
        if (run.provider === 'pathao') {
          const deliveredAt = parsePathaoActivity(await read(account, 'pathao', pathaoActivityPath(saved)), saved);
          await env.DB.prepare(`UPDATE shipments SET delivered_at = ?, delivery_checked_at = ?
            WHERE owner_id = ? AND provider = 'pathao' AND source_account_id = ? AND shipment_id = ? AND ${guard}`)
            .bind(deliveredAt, now(), run.owner_id, run.source_account_id, saved.shipmentId, run.id, token).run();
        } else {
          const parcel = parseSteadfastDetail(await read(account, 'steadfast', `/user/consignment/${saved.shipmentId}`), saved);
          await env.DB.batch(statements(run, parcel, true));
          if (!parcel.phone) skipped++;
        }
      }
    } else if (cursor) {
      if (run.provider === 'pathao') {
        const path = new URL(cursor, 'https://merchant.pathao.com');
        const result = parsePathao(await read(account, run.provider, cursor), Number(path.searchParams.get('page')), Number(path.searchParams.get('archive')));
        cursor = result.next; scanned = result.parcels.length;
        for (const parcel of result.parcels) { writes.push(...statements(run, parcel, true)); if (!parcel.phone || !['delivered', 'partial'].includes(parcel.status)) skipped++; }
      } else {
        const result = parseSteadfastList(await read(account, run.provider, cursor), cursor);
        if (result.sourceAccountId !== run.source_account_id) throw new HttpError(409, 'The courier merchant changed. Reconnect your account before importing.');
        cursor = result.next; scanned = result.parcels.length;
        for (const parcel of result.parcels) writes.push(...statements(run, parcel, false));
      }
    } else {
      await env.DB.prepare(`UPDATE courier_sync_runs SET status = 'complete', completed_at = ?, updated_at = ?, lease_token = NULL, lease_until = 0, error = NULL WHERE id = ? AND ${guard}`).bind(now(), now(), run.id, run.id, token).run();
      await enqueueWhatsAppChecks(run.owner_id); return;
    }
    writes.push(env.DB.prepare(`UPDATE courier_sync_runs SET cursor = ?, step = step + 1, scanned = scanned + ?, skipped = skipped + ?, attempts = 0,
      updated_at = ?, lease_token = NULL, lease_until = 0, error = NULL, dispatched_at = 0 WHERE id = ? AND ${guard}`).bind(cursor, scanned, skipped, now(), run.id, run.id, token));
    await env.DB.batch(writes);
    const next = await env.DB.prepare(`SELECT id, step FROM courier_sync_runs WHERE id = ? AND step = ? AND ${active}`).bind(run.id, run.step + 1).first<{ id: string; step: number }>();
    if (next) await dispatch(next, run.provider === 'pathao' && pending.results.length ? 15 : 0);
  } catch (error) {
    const attempts = run.attempts + 1;
    const terminal = attempts >= 5 || error instanceof HttpError && [400, 401, 403].includes(error.status);
    const safe = error instanceof HttpError ? error.message : 'The courier import could not finish. Try Sync now again.';
    await env.DB.prepare(`UPDATE courier_sync_runs SET status = ?, attempts = ?, error = ?, updated_at = ?, completed_at = ?, lease_token = NULL, lease_until = 0,
      dispatched_at = ? WHERE id = ? AND lease_token = ?`).bind(terminal ? 'failed' : 'queued', attempts, safe, now(), terminal ? now() : null, now(), run.id, token).run();
    if (!terminal) throw error;
  }
}
export async function scheduledSync() {
  const stale = await env.DB.prepare(`SELECT id, step FROM courier_sync_runs WHERE ${active} AND lease_until <= ? AND dispatched_at < ? LIMIT 40`).bind(now(), now() - 120).all<{ id: string; step: number }>();
  for (const run of stale.results) await dispatch(run);
  const due = await env.DB.prepare(`SELECT c.owner_id, c.provider FROM courier_credentials c WHERE c.encrypted_session IS NOT NULL AND c.auth_error IS NULL
    AND (c.owner_id = 'admin' OR EXISTS (SELECT 1 FROM users WHERE id = c.owner_id AND active = 1))
    AND NOT EXISTS (SELECT 1 FROM courier_sync_runs WHERE owner_id = c.owner_id AND provider = c.provider AND ${active})
    AND COALESCE((SELECT MAX(started_at) FROM courier_sync_runs WHERE owner_id = c.owner_id AND provider = c.provider), 0) <= ? LIMIT 20`).bind(now() - automaticSyncInterval).all<{ owner_id: string; provider: CourierProvider }>();
  for (const row of due.results) { const account = await accountForOwner(row.owner_id); if (account) { try { await startSync(account, row.provider, 'scheduled'); } catch { console.error(JSON.stringify({ event: 'lead_sync_dispatch_failed', provider: row.provider })); } } }
}
