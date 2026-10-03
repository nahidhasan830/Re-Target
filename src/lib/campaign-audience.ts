import { env } from 'cloudflare:workers';
import { leadAudienceSql } from './leads';
import { skipReasons, type Audience } from './campaign-content';

export type AudienceLead = {
  id: string;
  name: string;
  phone: string;
  excluded: number;
  whatsappExists: number | null;
  whatsappCheckedAt: number | null;
  chatId: string | null;
  nextAllowedAt: number | null;
  sources: string;
  deliveryCount: number;
  latestDelivery: number | null;
  totalParcelValue: number | null;
};
export function audienceSelection(ownerId: string, q: Audience) {
  const conditions: string[] = [],
    values: (string | number)[] = [ownerId];
  if (q.mode === 'selected') {
    conditions.push('a.id IN (SELECT value FROM json_each(?))');
    values.push(JSON.stringify(q.ids));
  }
  if (q.search) {
    const term = `%${q.search.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      "(a.name LIKE ? ESCAPE '\\' OR a.phone LIKE ? ESCAPE '\\')",
    );
    values.push(term, term);
  }
  if (q.source !== 'all') {
    conditions.push('a.sources LIKE ?');
    values.push(`%${q.source}%`);
  }
  if (q.eligibility !== 'all') {
    conditions.push('a.excluded = ?');
    values.push(q.eligibility === 'excluded' ? 1 : 0);
  }
  // Include unchecked contacts in the WhatsApp audience so incomplete checks remain visible.
  if (q.whatsapp === 'yes')
    conditions.push('(a.whatsappExists = 1 OR a.whatsappExists IS NULL)');
  if (q.whatsapp === 'no') conditions.push('a.whatsappExists = 0');
  if (q.whatsapp === 'unknown') conditions.push('a.whatsappExists IS NULL');
  if (q.dates !== 'all')
    conditions.push(
      `a.latestDelivery IS ${q.dates === 'known' ? 'NOT ' : ''}NULL`,
    );
  if (q.from) {
    conditions.push('a.latestDelivery >= ?');
    values.push(Date.parse(`${q.from}T00:00:00+06:00`) / 1000);
  }
  if (q.to) {
    conditions.push('a.latestDelivery < ?');
    values.push(Date.parse(`${q.to}T00:00:00+06:00`) / 1000 + 86400);
  }
  if (q.minDeliveries !== undefined) {
    conditions.push('a.deliveryCount >= ?');
    values.push(q.minDeliveries);
  }
  if (q.minValue !== undefined) {
    conditions.push('a.totalParcelValue >= ?');
    values.push(q.minValue);
  }
  return {
    sql: `${leadAudienceSql} SELECT a.*, l.whatsapp_chat_id AS chatId, cs.next_allowed_at AS nextAllowedAt
    FROM audience a JOIN leads l ON l.id = a.id AND l.owner_id = ?
    LEFT JOIN lead_contact_state cs ON cs.owner_id = l.owner_id AND cs.lead_id = l.id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
    values: [values[0]!, ownerId, ...values.slice(1)],
  };
}
export const reasonSql = `CASE WHEN excluded = 1 THEN 'excluded' WHEN whatsappExists = 0 THEN 'no_whatsapp'
  WHEN whatsappExists IS NOT 1 OR chatId IS NULL OR whatsappCheckedAt IS NULL OR whatsappCheckedAt < unixepoch()-604800 THEN 'not_verified'
  WHEN nextAllowedAt > unixepoch() THEN 'cooldown' END`;
export async function previewAudience(ownerId: string, q: Audience, requestedPage = 1, requestedSize = 25) {
  const selection = audienceSelection(ownerId, q);
  const pageSize = Math.max(1, Math.min(50, Number.isSafeInteger(requestedSize) ? requestedSize : 25));
  const requested = Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1);
  type Totals = { total: number; ready: number; excludedCount: number; noWhatsapp: number; notVerified: number; cooldown: number; noWhatsappCount: number; incompleteChecks: number };
  type Result = AudienceLead & Totals;
  const rows = await env.DB.prepare(`WITH selected AS MATERIALIZED (
      SELECT selection.*, ${reasonSql} AS reason FROM (${selection.sql}) selection
    ), totals AS (
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE reason IS NULL) AS ready,
        COUNT(*) FILTER (WHERE reason = 'excluded') AS excludedCount,
        COUNT(*) FILTER (WHERE reason = 'no_whatsapp') AS noWhatsapp,
        COUNT(*) FILTER (WHERE reason = 'not_verified') AS notVerified,
        COUNT(*) FILTER (WHERE reason = 'cooldown') AS cooldown,
        COUNT(*) FILTER (WHERE whatsappExists = 0) AS noWhatsappCount,
        COUNT(*) FILTER (WHERE whatsappExists IS NULL OR whatsappCheckedAt IS NULL OR whatsappCheckedAt < unixepoch()-604800) AS incompleteChecks
      FROM selected
    ) SELECT page.*, totals.* FROM totals LEFT JOIN (
      SELECT * FROM selected ORDER BY id LIMIT ? OFFSET (
        SELECT (MIN(MAX(1, CAST((total + ? - 1) / ? AS INTEGER)), ?) - 1) * ? FROM totals
      )
    ) page ON 1 = 1 ORDER BY id`)
    .bind(...selection.values, pageSize, pageSize, pageSize, requested, pageSize)
    .all<Result & { reason: string | null }>();
  const totals = rows.results[0]!;
  const pages = Math.max(1, Math.ceil(totals.total / pageSize));
  const breakdown = Object.fromEntries([
    ['ready', totals.ready], ['excluded', totals.excludedCount],
    ['no_whatsapp', totals.noWhatsapp], ['not_verified', totals.notVerified], ['cooldown', totals.cooldown],
  ].filter(([, count]) => Number(count) > 0)) as Record<string, number>;
  return {
    total: totals.total,
    page: Math.min(pages, requested),
    pages,
    pageSize,
    ready: totals.ready,
    breakdown,
    sample: rows.results.filter(row => row.id !== null).map(({
      total, ready, excludedCount, noWhatsapp, notVerified, cooldown, noWhatsappCount, incompleteChecks, reason, ...row
    }) => ({
      ...row,
      phone: row.phone.slice(2),
      reasons: skipReasons(row, Math.floor(Date.now() / 1000)),
    })),
    noWhatsappCount: totals.noWhatsappCount,
    incompleteChecks: totals.incompleteChecks,
  };
}
