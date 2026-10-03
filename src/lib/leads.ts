import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { syncStatus } from './lead-sync';
import { HttpError } from './http';

export type Lead = { id: string; name: string; phone: string; location: string | null; excluded: number; sources: string; deliveryCount: number; fullDeliveryCount: number; partialDeliveryCount: number; latestDelivery: number | null; totalParcelValue: number | null; averageParcelValue: number | null; valuedDeliveryCount: number; whatsappExists: number | null; whatsappCheckedAt: number | null };
export type Shipment = { id: string; provider: string; shipmentId: string; rawStatus: string; status: string; deliveredAt: number | null };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const timestamp = Date.parse(`${value}T00:00:00+06:00`);
  return Number.isFinite(timestamp) && new Date(timestamp + 21600000).toISOString().slice(0, 10) === value;
});
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().trim().max(120).default(''),
  source: z.enum(['all', 'pathao', 'steadfast']).default('all'),
  eligibility: z.enum(['all', 'eligible', 'excluded']).default('all'),
  whatsapp: z.enum(['all', 'yes', 'no', 'unknown']).default('all'),
  dates: z.enum(['all', 'known', 'unknown']).default('all'),
  from: date.optional(), to: date.optional(),
  sort: z.enum(['name', 'phone', 'sources', 'deliveryCount', 'latestDelivery', 'excluded', 'totalParcelValue', 'averageParcelValue', 'whatsappExists']).default('latestDelivery'),
  direction: z.enum(['asc', 'desc']).default('desc'),
}).refine(q => !q.from || !q.to || q.from <= q.to, { message: 'Start date must precede end date.' })
  .refine(q => q.dates !== 'unknown' || (!q.from && !q.to), { message: 'Unknown delivery dates cannot use a date range.' });

export function leadQuery(url: URL) {
  const parsed = querySchema.safeParse(Object.fromEntries([...url.searchParams].filter(([, value]) => value !== '')));
  if (!parsed.success) throw new HttpError(400, 'Check the search, filters, date range, and page size.');
  return parsed.data;
}

export const leadAudienceSql = `WITH audience AS MATERIALIZED (
  SELECT l.id, l.name, l.phone, l.location, l.excluded, l.whatsapp_exists AS whatsappExists, l.whatsapp_checked_at AS whatsappCheckedAt,
    COUNT(s.parcel_value_cents) AS valuedDeliveryCount,
    CASE WHEN COUNT(s.parcel_value_cents) = COUNT(s.id) THEN SUM(s.parcel_value_cents) / 100.0 END AS totalParcelValue,
    CASE WHEN COUNT(s.parcel_value_cents) = COUNT(s.id) THEN AVG(s.parcel_value_cents) / 100.0 END AS averageParcelValue,
    COUNT(s.id) AS deliveryCount, SUM(s.status = 'delivered') AS fullDeliveryCount, SUM(s.status = 'partial') AS partialDeliveryCount, MAX(s.delivered_at) AS latestDelivery,
    GROUP_CONCAT(DISTINCT s.provider) AS sources
  FROM leads l JOIN shipments s ON s.owner_id = l.owner_id AND s.lead_id = l.id AND (s.status = 'delivered' OR (s.provider = 'pathao' AND s.status = 'partial'))
  WHERE l.owner_id = ? GROUP BY l.id
)`;

export async function listLeads(ownerId: string, url: URL) {
  const q = leadQuery(url);
  const conditions: string[] = [];
  const values: (string | number)[] = [ownerId];
  if (q.search) {
    const term = q.search.replace(/[\\%_]/g, '\\$&');
    conditions.push("(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')");
    values.push(`%${term}%`, `%${term}%`);
  }
  if (q.source !== 'all') { conditions.push('sources LIKE ?'); values.push(`%${q.source}%`); }
  if (q.eligibility !== 'all') { conditions.push('excluded = ?'); values.push(q.eligibility === 'excluded' ? 1 : 0); }
  if (q.whatsapp === 'unknown') conditions.push('whatsappExists IS NULL');
  else if (q.whatsapp !== 'all') { conditions.push('whatsappExists = ?'); values.push(q.whatsapp === 'yes' ? 1 : 0); }
  if (q.dates !== 'all') conditions.push(`latestDelivery IS ${q.dates === 'known' ? 'NOT ' : ''}NULL`);
  if (q.from) { conditions.push('latestDelivery >= ?'); values.push(Date.parse(`${q.from}T00:00:00+06:00`) / 1000); }
  if (q.to) { conditions.push('latestDelivery < ?'); values.push(Date.parse(`${q.to}T00:00:00+06:00`) / 1000 + 86400); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = `${q.sort} IS NULL, ${q.sort} ${q.direction.toUpperCase()}, id ASC`;
  type Result = Lead & { filteredTotal: number; summaryTotal: number; eligible: number; pathao: number; steadfast: number };
  const rows = await env.DB.prepare(`${leadAudienceSql}, totals AS (
      SELECT COUNT(*) FILTER (WHERE ${conditions.join(' AND ') || '1 = 1'}) AS filteredTotal,
      COUNT(*) AS summaryTotal, COALESCE(SUM(excluded = 0), 0) AS eligible,
      COALESCE(SUM(sources LIKE '%pathao%'), 0) AS pathao, COALESCE(SUM(sources LIKE '%steadfast%'), 0) AS steadfast FROM audience)
    SELECT page.*, totals.* FROM totals LEFT JOIN (SELECT * FROM audience ${where} ORDER BY ${order} LIMIT ? OFFSET ?) page ON 1 = 1
    ORDER BY ${order}`).bind(...values, ...values.slice(1), q.size, (q.page - 1) * q.size).all<Result>();
  const totals = rows.results[0]!;
  const total = totals.filteredTotal;
  return {
    data: rows.results.filter(row => row.id !== null).map(({ filteredTotal, summaryTotal, eligible, pathao, steadfast, ...row }) => ({ ...row, phone: row.phone.slice(2) })),
    last_page: Math.max(1, Math.ceil(total / q.size)), last_row: total,
    summary: { total: totals.summaryTotal, eligible: totals.eligible, pathao: totals.pathao, steadfast: totals.steadfast },
    providers: await syncStatus(ownerId),
  };
}

export async function leadCheckStatus(ownerId: string, url: URL) {
  const parsed = z.array(z.uuid()).min(1).max(50).safeParse(url.searchParams.get('ids')?.split(','));
  if (!parsed.success) throw new HttpError(400, 'Choose 1–50 leads to check.');
  const ids = [...new Set(parsed.data)];
  const rows = await env.DB.prepare(`SELECT id, whatsapp_exists AS whatsappExists, whatsapp_checked_at AS whatsappCheckedAt
    FROM leads WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(ownerId, ...ids).all<Pick<Lead, 'id' | 'whatsappExists' | 'whatsappCheckedAt'>>();
  return { data: rows.results };
}

export async function leadHistory(ownerId: string, id: string, url: URL) {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, 'Lead not found.');
  const lead = await env.DB.prepare('SELECT id, name, phone, location, excluded FROM leads WHERE owner_id = ? AND id = ?').bind(ownerId, id).first();
  if (!lead) throw new HttpError(404, 'Lead not found.');
  const cursor = url.searchParams.get('cursor');
  if (cursor && !z.uuid().safeParse(cursor).success) throw new HttpError(400, 'Invalid history cursor.');
  const rows = await env.DB.prepare(`SELECT id, provider, shipment_id AS shipmentId, raw_status AS rawStatus, status, delivered_at AS deliveredAt
    FROM shipments WHERE owner_id = ? AND lead_id = ? ${cursor ? 'AND id > ?' : ''} ORDER BY id LIMIT 51`).bind(ownerId, id, ...(cursor ? [cursor] : [])).all<Shipment>();
  const campaigns = await env.DB.prepare(`SELECT c.id campaignId,c.name,c.status,MAX(m.accepted_at) acceptedAt FROM campaign_recipients r JOIN campaigns c ON c.owner_id=r.owner_id AND c.id=r.campaign_id
    LEFT JOIN campaign_messages m ON m.owner_id=r.owner_id AND m.recipient_id=r.id WHERE r.owner_id=? AND r.lead_id=? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 20`).bind(ownerId,id).all();
  const lastContact = await env.DB.prepare('SELECT last_contact_at FROM lead_contact_state WHERE owner_id=? AND lead_id=?').bind(ownerId,id).first<number>('last_contact_at');
  return { campaigns: campaigns.results, lastContact, lead: { ...lead, phone: String(lead.phone).slice(2) }, data: rows.results.slice(0, 50), nextCursor: rows.results.length > 50 ? rows.results[49]!.id : null };
}

export const exclusionInput = z.object({ ids: z.array(z.uuid()).min(1).max(50), excluded: z.boolean() }).strict();
export async function setExclusions(ownerId: string, input: z.infer<typeof exclusionInput>) {
  const ids = [...new Set(input.ids)];
  const placeholders = ids.map(() => '?').join(',');
  const found = await env.DB.prepare(`SELECT id FROM leads WHERE owner_id = ? AND id IN (${placeholders})`).bind(ownerId, ...ids).all();
  if (found.results.length !== ids.length) throw new HttpError(404, 'One or more leads were not found. Refresh and try again.');
  await env.DB.prepare(`UPDATE leads SET excluded = ? WHERE owner_id = ? AND id IN (${placeholders})`).bind(Number(input.excluded), ownerId, ...ids).run();
  return { updated: ids.length };
}
