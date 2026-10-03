import { parseSteadfastDetail, parseSteadfastList, type Parcel } from './courier-parcels';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
function createdDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(new Date(timestamp * 1000));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('day')} ${value('month')} ${value('year')}, ${value('hour')}:${value('minute')} ${value('dayPeriod')}`;
}
export function compactSteadfast(html: string, path: string) {
  if (path.startsWith('/user/consignment/status/delivered')) {
    const result = parseSteadfastList(html, path);
    const rows = result.parcels.map(parcel => `<tr><td><a href="https://steadfast.com.bd/user/consignment/${escape(parcel.shipmentId)}">${escape(parcel.shipmentId)}</a></td><td>${escape(parcel.invoice)}</td><td>${escape(parcel.name)}</td><td>${escape(parcel.address)}</td><td>${parcel.parcelValueCents === null ? '' : (parcel.parcelValueCents / 100).toFixed(2)}</td><td><span class="sf-badge">${escape(parcel.rawStatus)}</span></td></tr>`).join('');
    return `<script>window.Steadfast={"user_id":${result.sourceAccountId}}</script><main><table><tr>${['Consignment','Invoice','Recipient','Address','COD','Status'].map(label => `<th>${label}</th>`).join('')}</tr>${rows}</table>${result.next ? `<a rel="next" href="${escape(result.next)}">Next</a>` : ''}</main>`;
  }
  const match = path.match(/^\/user\/consignment\/(\d+)$/);
  if (!match) return html;
  const saved: Parcel = { shipmentId: match[1]!, name: '', phone: null, address: null, rawStatus: '', status: 'unknown', createdAt: null, statusUpdatedAt: null, deliveredAt: null, invoice: null, trackingCode: null, parcelValueCents: null };
  const parcel = parseSteadfastDetail(html, saved);
  return `<main><h1>Parcel #${escape(parcel.shipmentId)}</h1><section class="sf-parcel__card--recipient"><div class="sf-parcel__person"><b>${escape(parcel.name)}</b><p>${escape(parcel.address)}</p></div><ul class="sf-parcel__contacts"><li><span class="sf-parcel__contact-label">Phone</span><span class="sf-parcel__mono">${escape(parcel.phone)}</span></li></ul></section><dl><dt>Tracking code</dt><dd>${escape(parcel.trackingCode)}</dd><dt>Created</dt><dd>${parcel.createdAt === null ? '' : createdDate(parcel.createdAt)}</dd><dt>COD</dt><dd>${parcel.parcelValueCents === null ? '' : (parcel.parcelValueCents / 100).toFixed(2)}</dd></dl>${parcel.deliveredAt === null ? '' : `<ul><li><span class="sf-parcel__step">Consignment has been marked as delivered.</span><time datetime="${new Date(parcel.deliveredAt * 1000).toISOString()}"></time></li></ul>`}</main>`;
}
