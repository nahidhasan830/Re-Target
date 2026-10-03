import { parseDocument } from 'htmlparser2';
import { findAll, findOne, textContent } from 'domutils';
import { isTag, type AnyNode, type Element } from 'domhandler';
import { HttpError } from './http';

export type Parcel = { shipmentId: string; name: string; phone: string | null; address: string | null; rawStatus: string; status: 'delivered' | 'partial' | 'unknown'; createdAt: number | null; statusUpdatedAt: number | null; deliveredAt: number | null; invoice: string | null; trackingCode: string | null; parcelValueCents: number | null; sourceArchive?: number };
const bad = () => new HttpError(502, 'The courier returned an unexpected parcel page. Try again or reconnect.');
const text = (node: AnyNode | null | undefined) => node ? textContent(node).replace(/\s+/g, ' ').trim() : '';
const cls = (node: Element, value: string) => (node.attribs.class ?? '').split(/\s+/).includes(value);
const one = (nodes: AnyNode[], test: (node: Element) => boolean) => findOne(test, nodes, true);
const all = (nodes: AnyNode[], test: (node: Element) => boolean) => findAll(test, nodes);
export function courierPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let phone = value.replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit))).replace(/[\s()+-]/g, '');
  if (phone.startsWith('00880')) phone = phone.slice(2);
  if (/^01[3-9]\d{8}$/.test(phone)) phone = `88${phone}`;
  return /^8801[3-9]\d{8}$/.test(phone) ? phone : null;
}
export function parcelValue(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const amount = String(value).trim().replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit))).replace(/^(?:BDT|Tk\.?|৳)\s*/i, '').replace(/\s*(?:BDT|Tk\.?|৳)$/i, '').replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
  const cents = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}
export function sourceDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}+06:00` : value;
  const ms = Date.parse(date); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
export function parsePathao(body: string, page: number, archive: number) {
  let payload; try { payload = JSON.parse(body); } catch { throw bad(); }
  const data = payload?.data;
  if (payload.code !== 200 || !Array.isArray(data?.data) || data.current_page !== page || !Number.isSafeInteger(data.last_page) || data.last_page < 1 || !Number.isSafeInteger(data.total) || data.total < 0 || (page < data.last_page && !data.data.length)) throw bad();
  const parcels: Parcel[] = data.data.map((row: Record<string, unknown>) => {
    if (!row || typeof row.order_consignment_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.order_consignment_id) || typeof row.order_status !== 'string' || typeof row.recipient_name !== 'string' || typeof row.recipient_phone !== 'string') throw bad();
    return { shipmentId: row.order_consignment_id, name: row.recipient_name.slice(0, 240), phone: courierPhone(row.recipient_phone), address: typeof row.recipient_address === 'string' ? row.recipient_address.slice(0, 2000) : null,
      rawStatus: row.order_status, status: row.order_status === 'Delivered' ? 'delivered' : row.order_status === 'Partial Delivery' ? 'partial' : 'unknown',
      createdAt: pathaoDate(row.order_created_at), statusUpdatedAt: pathaoDate(row.order_status_updated_at), deliveredAt: null, sourceArchive: archive,
      invoice: typeof row.merchant_order_id === 'string' ? row.merchant_order_id.slice(0, 240) : null, trackingCode: null, parcelValueCents: parcelValue(row.amount_to_collect ?? row.order_amount) };
  });
  const next = page < data.last_page ? pathaoPath(page + 1, archive) : archive === 0 ? pathaoPath(1, 1) : null;
  return { parcels, next, total: data.total };
}
function pathaoDate(value: unknown): number | null {
  return sourceDate(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}
export function pathaoActivityPath(parcel: Parcel): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(parcel.shipmentId) || !parcel.phone || !/^8801[3-9]\d{8}$/.test(parcel.phone) || ![0, 1].includes(parcel.sourceArchive ?? 0)) throw bad();
  return `/api/v1/orders/${parcel.shipmentId}/${parcel.phone.slice(2)}/activity?archive=${parcel.sourceArchive ?? 0}`;
}
export function parsePathaoActivity(body: string, parcel: Parcel): number | null {
  let payload; try { payload = JSON.parse(body); } catch { throw bad(); }
  if (payload?.code !== 200 || !Array.isArray(payload.data?.log)) throw bad();
  const dates: number[] = [];
  const deliveryEvent = parcel.status === 'partial' ? 'Partially delivered.' : 'Delivered.';
  for (const event of payload.data.log) {
    if (!event || event.consignment_id !== parcel.shipmentId || typeof event.desc !== 'string') throw bad();
    if (event.desc.trim() !== deliveryEvent) continue;
    const match = typeof event.created_at === 'string' && event.created_at.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/);
    if (!match) throw bad();
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[1]!);
    const day = Number(match[2]), year = Number(match[3]), hour = Number(match[4]), minute = Number(match[5]);
    const utc = new Date(Date.UTC(year, month, day, hour % 12 + (match[6] === 'PM' ? 12 : 0), minute));
    if (hour < 1 || hour > 12 || minute > 59 || utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month || utc.getUTCDate() !== day) throw bad();
    dates.push(Math.floor(utc.getTime() / 1000) - 6 * 3600);
  }
  return dates.length ? Math.max(...dates) : null;
}
export const pathaoPath = (page = 1, archive = 0) => `/api/v1/orders/all?transfer_status=2&archive=${archive}&page=${page}&limit=200`;
export function steadfastPath(url: string): string {
  const parsed = new URL(url, 'https://steadfast.com.bd');
  if (parsed.origin !== 'https://steadfast.com.bd' || parsed.username || parsed.password || parsed.hash || parsed.pathname !== '/user/consignment/status/delivered' || [...parsed.searchParams.keys()].some(key => key !== 'cursor') || parsed.searchParams.getAll('cursor').length > 1 || (parsed.searchParams.has('cursor') && !/^[A-Za-z0-9_=-]{1,2048}$/.test(parsed.searchParams.get('cursor')!))) throw bad();
  return parsed.pathname + parsed.search;
}
export function parseSteadfastList(html: string, currentPath: string) {
  const document = parseDocument(html);
  const main = one(document.children, node => node.name === 'main');
  const table = main && one(main.children, node => node.name === 'table');
  if (!main || !table) throw bad();
  const headers = all(table.children, node => node.name === 'th').map(text);
  for (const value of ['Consignment', 'Recipient', 'Address', 'Status']) if (!headers.includes(value)) throw bad();
  const parcels: Parcel[] = [];
  for (const row of all(table.children, node => node.name === 'tr')) {
    const cells = row.children.filter((node): node is Element => isTag(node) && node.name === 'td');
    if (!cells.length) continue;
    if (cells.length === 1 && /no .*?(?:parcel|consignment|record)|no data|nothing/i.test(text(cells[0]))) continue;
    if (cells.length !== headers.length) throw bad();
    const cell = (label: string) => cells[headers.indexOf(label)];
    const link = one(cell('Consignment').children, node => node.name === 'a');
    const match = link?.attribs.href?.match(/^https:\/\/steadfast\.com\.bd\/user\/consignment\/(\d+)$/);
    if (!match) throw bad();
    const badge = one(cell('Status').children, node => cls(node, 'sf-badge'));
    const rawStatus = text(badge); if (!rawStatus) throw bad();
    const invoice = text(cell('Invoice'));
    parcels.push({ shipmentId: match[1]!, name: text(cell('Recipient')).slice(0, 240), phone: null, address: text(cell('Address')).slice(0, 2000), rawStatus, status: rawStatus === 'Delivered' ? 'delivered' : 'unknown', createdAt: null, statusUpdatedAt: null, deliveredAt: null, invoice: ['', '—', '-'].includes(invoice) ? null : invoice, trackingCode: null, parcelValueCents: parcelValue(text(cell('COD') ?? cell('COD Amount') ?? cell('Amount'))) });
  }
  const nextNode = one(main.children, node => node.name === 'a' && node.attribs.rel === 'next' && node.attribs['aria-disabled'] !== 'true' && Boolean(node.attribs.href) && node.attribs.href !== '#');
  const next = nextNode ? steadfastPath(nextNode.attribs.href!) : null;
  if (next === currentPath || (next && !parcels.length)) throw bad();
  const userId = html.match(/"user_id"\s*:\s*(\d+)/)?.[1];
  if (!userId) throw bad();
  return { parcels, next, sourceAccountId: userId };
}
export function parseSteadfastDetail(html: string, parcel: Parcel): Parcel {
  const document = parseDocument(html);
  const main = one(document.children, node => node.name === 'main');
  const heading = main && one(main.children, node => node.name === 'h1');
  if (!main || !text(heading).includes(`#${parcel.shipmentId}`)) throw bad();
  const card = one(main.children, node => cls(node, 'sf-parcel__card--recipient'));
  const person = card && one(card.children, node => cls(node, 'sf-parcel__person'));
  const contacts = card && one(card.children, node => cls(node, 'sf-parcel__contacts'));
  if (!person || !contacts) throw bad();
  const phoneRow = one(contacts.children, node => node.name === 'li' && Boolean(one(node.children, child => cls(child, 'sf-parcel__contact-label') && text(child) === 'Phone')));
  const number = phoneRow && one(phoneRow.children, node => cls(node, 'sf-parcel__mono'));
  if (!number) throw bad();
  const name = text(one(person.children, node => node.name === 'b'));
  const address = text(one(person.children, node => node.name === 'p' && !cls(node, 'sf-parcel__area')));
  let trackingCode: string | null = null, createdAt: number | null = null, parcelValueCents = parcel.parcelValueCents ?? null;
  for (const label of all(main.children, node => node.name === 'dt')) {
    let sibling = label.nextSibling;
    while (sibling && !isTag(sibling)) sibling = sibling.nextSibling;
    const content = '';
    if (!sibling || !isTag(sibling) || sibling.name !== 'dd') continue;
    if (['cod', 'cod amount', 'cash on delivery', 'collection amount', 'amount to collect'].includes(text(label).toLowerCase())) parcelValueCents = parcelValue(text(sibling));
    if (text(label) === 'Tracking code') trackingCode = text(sibling) || content || null;
    if (text(label) === 'Created') { const raw = text(sibling) || content; const match = raw.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/); if (match) { const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[2]!) + 1; const hour = Number(match[4]) % 12 + (match[6] === 'PM' ? 12 : 0); createdAt = sourceDate(`${match[3]}-${String(month).padStart(2,'0')}-${match[1]!.padStart(2,'0')}T${String(hour).padStart(2,'0')}:${match[5]}:00+06:00`); } else if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) createdAt = sourceDate(raw); }
  }
  const dates: number[] = [];
  for (const event of all(main.children, node => node.name === 'li')) {
    const label = text(one(event.children, node => cls(node, 'sf-parcel__step')));
    if (!['Consignment has been marked as delivered by rider.', 'Consignment has been marked as delivered.'].includes(label)) continue;
    const time = one(event.children, node => node.name === 'time');
    const timestamp = sourceDate(time?.attribs.datetime); if (timestamp !== null) dates.push(timestamp);
  }
  return { ...parcel, name: name.slice(0, 240), phone: courierPhone(text(number)), address: address.slice(0, 2000) || null, createdAt, statusUpdatedAt: null, trackingCode, parcelValueCents, deliveredAt: dates.length ? Math.max(...dates) : null };
}
