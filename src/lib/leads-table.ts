import { setRegionLoading } from './loading-region';
import { setButtonBusy } from './control-state';
import { setFeedback } from './feedback';
import type { CellComponent, ColumnDefinition } from 'tabulator-tables';
import { createDataTable } from './data-table';
import { anchorPopover } from './anchored-popover';
import type { Lead, Shipment } from './leads';
import type { syncStatus } from './lead-sync';

type LeadResponse = { data: Lead[]; last_page: number; last_row: number; summary: { total: number; eligible: number; pathao: number; steadfast: number }; providers: Awaited<ReturnType<typeof syncStatus>> };
const root = document.querySelector<HTMLElement>('.leads-root')!;
const element = <T = HTMLElement>(id: string) => document.getElementById(id) as T;
const filters = element<HTMLFormElement>('lead-filters');
const tableElement = element<HTMLDivElement>('leads-table');
anchorPopover(element('create-campaign-toggle'), element('create-campaign-options'));
anchorPopover(element('date-toggle'), element('date-filters'));
anchorPopover(root.querySelector<HTMLElement>('[popovertarget=lead-columns]')!, element('lead-columns'));
const detail = element<HTMLDialogElement>('lead-detail');
const exclusion = element<HTMLInputElement>('detail-excluded');
const mobile = matchMedia('(max-width: 760px)');
const formatMoney = new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyLabel = (value: number | null) => value === null ? 'Unknown' : formatMoney.format(value);
const formatNumber = new Intl.NumberFormat('en-BD');
const formatDate = new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' });
const dateLabel = (value: number | null) => value === null ? 'Unknown date' : formatDate.format(new Date(value * 1000));
const sourceLabel = (value: string) => value.split(',').sort().map(source => source === 'pathao' ? 'Pathao' : 'Steadfast').join(' · ');
let total = 0;
let loading = false, failed = false, writing = false, tableReady = false;
let detailController: AbortController | undefined;
let detailId: string | null = null, historyCursor: string | null = null;
let detailBusy = false;
let currentData: Lead[] = [];
const preferences = new Map<string, boolean>();

function message(text: string, error = false, success = '') {
  const node = element<HTMLDivElement>('lead-message');
  setFeedback(node, text, success);
  node.dataset.error = String(error);
  node.hidden = !text;
}
function filterParams() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(filters)) if (String(value)) params.set(key, String(value));
  return params;
}
const hasActiveFilters = () => [...filterParams()].some(([key, value]) => key === 'search' ? Boolean(value) : !['all', ''].includes(value));
function updateControls() {
  const selected = table.getSelectedData() as Lead[];
  const box = tableElement.querySelector<HTMLInputElement>('.tabulator-header input[type=checkbox]');
  const firstRows = table.getRows().slice(0, 50);
  if (box) { box.checked = firstRows.length > 0 && firstRows.every(row => row.isSelected()); box.indeterminate = selected.length > 0 && !box.checked; }
  element('selection-count').textContent = selected.length ? `${selected.length} selected` : '';
  element('clear-filters').hidden = !hasActiveFilters();
  for (const id of ['exclude-selected', 'allow-selected', 'campaign-from-selected']) element<HTMLButtonElement>(id).disabled = !selected.length || loading || writing || failed;
  setButtonBusy(element<HTMLButtonElement>('refresh-leads'), loading, writing);
}
function updateSummary(response: LeadResponse) {
  total = response.last_row;
  element('lead-count').textContent = formatNumber.format(response.summary.total);
  for (const provider of ['pathao', 'steadfast'] as const) element(`${provider}-count`).textContent = `${sourceLabel(provider)} (${formatNumber.format(response.summary[provider])})`;
  updateSync(response.providers);
  const hasFilters = hasActiveFilters();
  const empty = element('lead-empty');
  empty.hidden = total > 0;
  const configured = response.providers.some(provider => provider.configured);
  const syncing = response.providers.some(provider => ['queued', 'running'].includes(provider.status));
  const connected = response.providers.some(provider => provider.connected);
  element('empty-title').textContent = hasFilters ? 'No matching leads' : syncing ? 'Importing your customers' : connected ? 'No leads yet' : 'Connect your first courier';
  element('empty-copy').textContent = hasFilters ? 'Try another name, phone number, or filter.' : syncing ? '' : connected ? 'Use Sync now to check your courier deliveries.' : 'Connect Pathao or Steadfast to import your customers.';
  element('empty-setup').hidden = hasFilters || syncing || connected;
  element('empty-setup').textContent = configured ? 'Review courier settings' : 'Set up a courier';
  tableElement.classList.toggle('is-empty', !total);
}
function selectionCell(cell: CellComponent) {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', `Select ${cell.getRow().getData().name || cell.getRow().getData().phone}`);
  checkbox.checked = cell.getRow().isSelected();
  checkbox.addEventListener('click', event => event.stopPropagation());
  checkbox.addEventListener('change', () => { cell.getRow().toggleSelect(); checkbox.checked = cell.getRow().isSelected(); });
  const label = document.createElement('label'); label.className = 'lead-select-target'; label.appendChild(checkbox); return label;
}
function identityCell(cell: CellComponent) {
  const data = cell.getRow().getData() as Lead;
  const node = document.createElement('div'); node.className = 'lead-identity';
  const name = document.createElement('strong'); name.textContent = data.name || 'Unnamed customer';
  name.title = data.name || 'Unnamed customer';
  node.appendChild(name); return node;
}
function detailCell(cell: CellComponent) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'detail-button';
  button.textContent = 'View'; button.setAttribute('aria-label', `View ${cell.getRow().getData().name || cell.getRow().getData().phone}`);
  button.addEventListener('click', event => { event.stopPropagation(); void openDetail(cell.getRow().getData() as Lead); });
  return button;
}
function whatsAppCell(cell: CellComponent) {
  const lead = cell.getRow().getData() as Lead;
  const node = document.createElement('span');
  node.className = lead.whatsappExists === 1 ? 'whatsapp-account' : 'whatsapp-unchecked';
  if (lead.whatsappExists === 1) {
    node.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 11.5a9 9 0 0 1-13.4 7.9L3 21l1.6-4.6A9 9 0 1 1 21 11.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 7.5c0 4.5 4 8.5 8.5 8.5l1-2.5-3-1-1 1c-1.7-.8-3-2.1-3.8-3.8l1-1-1-3-1.7 1.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    node.setAttribute('aria-label', 'Has WhatsApp');
    node.title = `Has WhatsApp · Checked ${dateLabel(lead.whatsappCheckedAt)}`;
  } else node.textContent = lead.whatsappExists === 0 ? 'None' : 'Not checked';
  return node;
}
function moneyCell(cell: CellComponent) {
  const value = document.createElement('span');
  value.textContent = moneyLabel(cell.getValue());
  const lead = cell.getRow().getData() as Lead;
  value.title = lead.valuedDeliveryCount < lead.deliveryCount ? `COD amount available for ${lead.valuedDeliveryCount} of ${lead.deliveryCount} deliveries. Sync to check missing amounts.` : 'COD/collection amount in BDT';
  return value;
}
const columns: ColumnDefinition[] = [
  { title: '', field: '_select', width: 44, minWidth: 44, headerSort: false, resizable: false, formatter: selectionCell, headerTooltip: 'Select up to 50 leads', titleFormatter: () => {
    const box = document.createElement('input'); box.type = 'checkbox'; box.setAttribute('aria-label', 'Select first 50 loaded leads');
    box.addEventListener('click', event => event.stopPropagation());
    box.addEventListener('change', () => { if (box.checked) table.selectRow(table.getRows().slice(0, 50)); else table.deselectRow(); });
    const label = document.createElement('label'); label.className = 'lead-select-target'; label.appendChild(box); return label;
  } },
  { title: 'Customer', field: 'name', minWidth: 90, widthGrow: 2, formatter: identityCell },
  { title: 'Phone', field: 'phone', minWidth: 115, width: 115, formatter: 'plaintext' },
  { title: 'Courier', field: 'sources', minWidth: 145, widthGrow: 1, formatter: cell => sourceLabel(String(cell.getValue())) },
  { title: 'Total Parcels', field: 'deliveryCount', minWidth: 105, width: 105, formatter: cell => formatNumber.format(cell.getValue()) },
  { title: 'Latest delivery', field: 'latestDelivery', minWidth: 125, formatter: cell => dateLabel(cell.getValue()) },
  { title: 'Total Value (BDT)', field: 'totalParcelValue', minWidth: 120, widthGrow: 1, formatter: moneyCell, headerWordWrap: true, headerSortStartingDir: 'desc' },
  { title: 'Average Value (BDT)', field: 'averageParcelValue', minWidth: 125, widthGrow: 1, formatter: moneyCell, headerWordWrap: true, headerSortStartingDir: 'desc' },
  { title: 'Contact', field: 'whatsappExists', minWidth: 110, width: 110, formatter: whatsAppCell },
  { title: 'Preference', visible: false, field: 'excluded', minWidth: 138, formatter: cell => {
    const badge = document.createElement('span'); badge.className = `eligibility${cell.getValue() ? ' excluded' : ''}`; badge.textContent = cell.getValue() ? 'Do not contact' : 'Eligible'; return badge;
  } },
  { title: '', field: '_detail', width: 44, minWidth: 44, frozen: true, headerSort: false, resizable: false, formatter: detailCell },
];
const dataTable = createDataTable<Lead, LeadResponse>(root.querySelector<HTMLElement>('[data-table]')!, {
  columns, rowLabel: 'leads', batchSize: mobile.matches ? 25 : 50,
  initialSort: { field: 'latestDelivery', dir: 'desc' },
  tableOptions: {
    selectableRows: 50, selectableRowsRollingSelection: false,
    selectableRowsCheck: () => !writing && !loading && !failed,
  },
  fetchPage: async (page, size, sort, signal) => {
    const query = filterParams();
    query.set('page', String(page)); query.set('size', String(size));
    if (sort) { query.set('sort', sort.field); query.set('direction', sort.dir); }
    const response = await fetch(`/api/leads?${query}`, { signal });
    const result = await response.json() as LeadResponse & { error?: string };
    if (!response.ok) throw new Error(result.error || 'Could not load leads. Try again.');
    return result;
  },
  onResponse: updateSummary,
  onState: state => {
    loading = state.loading; failed = Boolean(state.error); currentData = state.rows;
    if (state.loading && !state.rows.length) {
      element('lead-empty').hidden = true; tableElement.classList.remove('is-empty');
      message('');
    }
    if (state.error) element('lead-empty').hidden = true;
    queueMicrotask(() => { updateControls(); resizeTable(); });
  },
});
const { table } = dataTable;
function resizeTable() {
  if (!tableReady || !tableElement.isConnected) return;
  const top = tableElement.getBoundingClientRect().top + window.scrollY;
  const footer = root.querySelector('.data-table-footer')!.getBoundingClientRect().height;
  const padding = parseFloat(getComputedStyle(document.querySelector('main')!).paddingBottom);
  const height = Math.max(mobile.matches ? 220 : 260, window.innerHeight - top - footer - padding - 2);
  if (Math.abs(parseFloat(tableElement.style.height) - height) > 1) {
    const holder = tableElement.querySelector<HTMLElement>('.tabulator-tableholder')!;
    const scrollTop = holder.scrollTop, scrollLeft = holder.scrollLeft;
    table.setHeight(height);
    holder.scrollTop = scrollTop; holder.scrollLeft = scrollLeft;
  }
  element('lead-empty').style.minHeight = `${Math.max(180, height - (tableElement.querySelector('.tabulator-header')?.getBoundingClientRect().height ?? 52))}px`;
}
function applyColumns() {
  (filters.elements.namedItem('search') as HTMLInputElement).placeholder = mobile.matches ? 'Search' : 'Search name or phone';
  for (const column of columns) {
    if (!column.field || column.field.startsWith('_') || ['name', 'phone'].includes(column.field)) continue;
    const show = !mobile.matches && (preferences.get(column.field) ?? column.visible !== false);
    if (show) table.showColumn(column.field); else table.hideColumn(column.field);
  }
  table.redraw(true); resizeTable();
}
table.on('tableBuilt', () => {
  tableReady = true;
  applyColumns();
  for (const column of columns.filter(column => column.title && column.field)) {
    const label = document.createElement('label'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = column.visible !== false;
    checkbox.disabled = ['name', 'phone'].includes(column.field!);
    checkbox.addEventListener('change', () => { preferences.set(column.field!, checkbox.checked); applyColumns(); });
    label.appendChild(checkbox); label.appendChild(document.createTextNode(String(column.title))); element('column-options').appendChild(label);
  }
});
for (const event of ['rowSelected', 'rowDeselected'] as const) table.on(event, row => {
  const checkbox = row.getCell('_select').getElement().querySelector('input');
  if (checkbox) checkbox.checked = row.isSelected();
});
table.on('rowSelectionChanged', updateControls);
table.on('dataLoaded', () => queueMicrotask(updateControls));
table.on('dataLoadError', () => {});
window.addEventListener('resize', resizeTable);
new ResizeObserver(() => resizeTable()).observe(document.querySelector('.topbar')!);
new ResizeObserver(() => resizeTable()).observe(element('lead-filters'));
new ResizeObserver(() => resizeTable()).observe(element('sync-progress'));
new ResizeObserver(() => resizeTable()).observe(element('lead-message'));
new ResizeObserver(() => resizeTable()).observe(element('selection-controls'));
mobile.addEventListener('change', applyColumns);
const refresh = () => dataTable.reload();
let searchTimer: ReturnType<typeof setTimeout>;
filters.querySelector<HTMLInputElement>('[name=search]')?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void refresh(), 300); });
for (const name of ['source', 'eligibility', 'whatsapp']) (filters.querySelector(`[name=${name}]`) as HTMLSelectElement | null)?.addEventListener('change', () => void refresh());
(filters.querySelector('[name=dates]') as HTMLSelectElement | null)?.addEventListener('change', () => {
  const unknown = (filters.querySelector('[name=dates]') as unknown as HTMLSelectElement).value === 'unknown';
  for (const name of ['from', 'to']) { const input = filters.elements.namedItem(name) as HTMLInputElement; input.disabled = unknown; if (unknown) input.value = ''; }
});
filters.addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); element('date-filters').hidePopover(); void refresh(); });
element('refresh-leads').addEventListener('click', () => void dataTable.refresh());
element('clear-filters').addEventListener('click', () => { filters.reset(); for (const name of ['from', 'to']) (filters.elements.namedItem(name) as HTMLInputElement).disabled = false; clearTimeout(searchTimer); void refresh(); });


async function saveExclusions(ids: string[], excluded: boolean) {
  const response = await fetch('/api/leads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, excluded }) });
  const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || 'Could not save contact preference. Try again.');
}
async function bulkExclusion(excluded: boolean) {
  const ids = (table.getSelectedData() as Lead[]).map(lead => lead.id);
  if (!ids.length || writing || loading || failed) return;
  const button = element<HTMLButtonElement>(excluded ? 'exclude-selected' : 'allow-selected');
  writing = true; updateControls(); setButtonBusy(button, true, false, 'Saving...'); message('Saving contact preferences...');
  try { await saveExclusions(ids, excluded); await refresh(); message(`${ids.length} ${ids.length === 1 ? 'contact' : 'contacts'} ${excluded ? 'marked do not contact' : 'allowed for contact'}.`, false, 'Updated'); }
  catch (error) { message(error instanceof Error ? error.message : 'Could not save contact preferences.', true); }
  finally { writing = false; setButtonBusy(button, false); updateControls(); }
}
element('exclude-selected').addEventListener('click', () => void bulkExclusion(true));
element('allow-selected').addEventListener('click', () => void bulkExclusion(false));
async function openDetail(lead: Lead) {
  detailController?.abort(); detailController = new AbortController(); detailId = lead.id; historyCursor = null; detailBusy = false;
  element('more-history').textContent = 'Load more shipments';
  element('detail-name').textContent = lead.name || 'Unnamed customer'; element('detail-phone').textContent = lead.phone;
  element('detail-whatsapp').textContent = lead.whatsappExists === 1 ? `Has WhatsApp · Checked ${dateLabel(lead.whatsappCheckedAt)}` : lead.whatsappExists === 0 ? 'No WhatsApp account' : 'WhatsApp not checked · Checks run automatically when WhatsApp is connected.';
  element('detail-total-value').textContent = moneyLabel(lead.totalParcelValue);
  element('detail-average-value').textContent = moneyLabel(lead.averageParcelValue);
  element('detail-location').textContent = lead.location || ''; element('shipment-history').replaceChildren();
  exclusion.checked = Boolean(lead.excluded); exclusion.disabled = true; element('more-history').hidden = true;
  document.documentElement.classList.add('lead-detail-open'); detail.showModal(); await loadHistory(false);
}
async function loadHistory(more: boolean) {
  if (!detailId || detailBusy) return;
  const id = detailId, controller = detailController!;
  detailBusy = true; setFeedback(element('detail-message'), 'Loading shipment history…'); setButtonBusy(element<HTMLButtonElement>('more-history'), true);
  setRegionLoading('shipment-history-loading', !more);
  try {
    const response = await fetch(`/api/leads/${id}${more && historyCursor ? `?cursor=${historyCursor}` : ''}`, { signal: controller.signal });
    const result = await response.json() as { error?: string; lead: Lead; data: Shipment[]; nextCursor: string | null }; if (!response.ok) throw new Error(result.error || 'Could not load shipment history.');
    if (detailId !== id || !detail.open) return;
    exclusion.checked = Boolean(result.lead.excluded); exclusion.disabled = false;
    if (!more) {
      const evidence = result as typeof result & { campaigns: { campaignId:string;name:string;status:string;acceptedAt:number|null }[]; lastContact:number|null };
      element('lead-last-contact').textContent = evidence.lastContact ? `Last campaign contact: ${dateLabel(evidence.lastContact)}` : '';
      element('lead-campaign-history').replaceChildren();
      for (const campaign of evidence.campaigns ?? []) { const item = document.createElement('li'), link = document.createElement('a'); link.href = `${root.dataset.courierUrl!.replace('/courier', '')}/campaigns/${campaign.campaignId}`; link.textContent = `${campaign.name} · ${campaign.status}`; item.appendChild(link); element('lead-campaign-history').appendChild(item); }
    }
    for (const shipment of result.data as Shipment[]) {
      const item = document.createElement('li'), title = document.createElement('strong'), status = document.createElement('span'), date = document.createElement('span');
      title.textContent = `${sourceLabel(shipment.provider)} · ${shipment.shipmentId}`;
      status.textContent = `${shipment.status.charAt(0).toUpperCase() + shipment.status.slice(1)} · ${shipment.rawStatus}`;
      date.textContent = shipment.status === 'delivered' ? dateLabel(shipment.deliveredAt) : '';
      item.appendChild(title); item.appendChild(status); item.appendChild(date); element('shipment-history').appendChild(item);
    }
    historyCursor = result.nextCursor; element('more-history').hidden = !historyCursor;
    setFeedback(element('detail-message'), result.data.length || more ? '' : 'No shipments recorded.');
  } catch (error) { if (!controller.signal.aborted) { setFeedback(element('detail-message'), error instanceof Error ? error.message : 'Could not load shipment history.'); element('more-history').hidden = false; element('more-history').textContent = 'Retry history'; } }
  finally { if (detailController === controller) { detailBusy = false; setRegionLoading('shipment-history-loading', false); setButtonBusy(element<HTMLButtonElement>('more-history'), false); } }
}
element('more-history').addEventListener('click', () => void loadHistory(Boolean(historyCursor)));
element('close-detail').addEventListener('click', () => detail.close());
detail.addEventListener('close', () => { document.documentElement.classList.remove('lead-detail-open'); detailController?.abort(); detailId = null; });
detail.addEventListener('click', event => { if (event.target === detail && event.clientX < detail.getBoundingClientRect().left) detail.close(); });
exclusion.addEventListener('change', async () => {
  if (!detailId) return;
  const id = detailId, excluded = exclusion.checked; exclusion.disabled = true;
  setFeedback(element('detail-message'), 'Saving...');
  try { await saveExclusions([id], excluded); if (detailId === id) setFeedback(element('detail-message'), 'Contact preference saved.', 'Saved'); await refresh(); }
  catch (error) { if (detailId === id) { exclusion.checked = !excluded; setFeedback(element('detail-message'), error instanceof Error ? error.message : 'Could not save preference.'); } }
  finally { if (detailId === id) exclusion.disabled = false; }
});


type ProviderSync = Awaited<ReturnType<typeof syncStatus>>[number];
let syncProviders: ProviderSync[] = [];
let syncBusy = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
function updateSync(providers: ProviderSync[]) {
  syncProviders = providers;
  const running = providers.some(provider => ['queued', 'running'].includes(provider.status));
  const button = element<HTMLButtonElement>('sync-leads');
  const busy = syncBusy || running;
  button.disabled = busy || !providers.some(provider => provider.syncAvailable);
  button.setAttribute('aria-busy', String(busy));
  button.setAttribute('aria-label', busy ? 'Syncing couriers' : 'Sync now');
  button.querySelector('.sync-spinner')!.toggleAttribute('hidden', !busy);
  const progress = element('sync-progress');
  const errors = providers.filter(provider => provider.error).map(provider => `${sourceLabel(provider.provider)}: ${provider.error}`);
  progress.hidden = !errors.length;
  progress.dataset.error = 'true';
  progress.textContent = errors.join(' ');
  clearTimeout(syncTimer);
  if (!document.hidden) syncTimer = setTimeout(() => void pollSync(), running ? 5000 : 60000);
}
async function pollSync() {
  if (document.hidden || polling) return;
  polling = true;
  try {
    const response = await fetch('/api/leads/sync');
    if (!response.ok) throw new Error('Could not check courier import progress.');
    const result = await response.json() as { providers: ProviderSync[] };
    const changed = result.providers.some(provider => {
      const previous = syncProviders.find(saved => saved.provider === provider.provider);
      return previous?.runId !== provider.runId || previous?.updatedAt !== provider.updatedAt || previous?.status !== provider.status || previous?.newLeads !== provider.newLeads;
    });
    updateSync(result.providers);
    if (!loading && !writing && !failed && !detail.open && !table.getSelectedData().length) {
      let checksChanged = false;
      const unchecked = currentData.filter(lead => lead.whatsappExists === null).slice(0, 50);
      if (!changed && unchecked.length) {
        const response = await fetch(`/api/leads/checks?${new URLSearchParams({ ids: unchecked.map(lead => lead.id).join(',') })}`);
        if (!response.ok) throw new Error('Could not check contact progress.');
        const result = await response.json() as { data: Pick<Lead, 'id' | 'whatsappExists' | 'whatsappCheckedAt'>[] };
        checksChanged = result.data.some(lead => lead.whatsappExists !== null);
      }
      if (changed || checksChanged) await dataTable.refresh();
    }
  } catch { clearTimeout(syncTimer); syncTimer = setTimeout(() => void pollSync(), 60000); }
  finally { polling = false; }
}
element('sync-leads').addEventListener('click', async () => {
  if (syncBusy || syncProviders.some(provider => ['queued', 'running'].includes(provider.status))) return;
  syncBusy = true; updateSync(syncProviders); message('');
  try {
    const response = await fetch('/api/leads/sync', { method: 'POST' });
    const result = await response.json() as { providers?: ProviderSync[]; error?: string };
    if (!response.ok) throw new Error(result.error || 'Could not start the import. Try again.');
    if (result.providers) updateSync(result.providers);
    await dataTable.refresh();
  } catch (error) { message(error instanceof Error ? error.message : 'Could not start the import.', true); }
  finally { syncBusy = false; updateSync(syncProviders); }
});
document.addEventListener('visibilitychange', () => { clearTimeout(syncTimer); if (!document.hidden) void pollSync(); });
window.addEventListener('pagehide', () => clearTimeout(syncTimer));

for (const mode of ['selected', 'matching']) element(`campaign-from-${mode}`).addEventListener('click', () => {
  const selected = table.getSelectedData() as Lead[];
  const audience = mode === 'selected' ? { mode: 'selected', ids: selected.map(lead => lead.id), whatsapp: 'all' } : { mode: 'all', ...Object.fromEntries(filterParams()) };
  sessionStorage.setItem('campaign-audience', JSON.stringify(audience));
  location.href = `${root.dataset.courierUrl!.replace('/courier', '')}/campaigns/new`;
});
