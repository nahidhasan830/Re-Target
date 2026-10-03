import { TabulatorFull as Tabulator, type ColumnDefinition, type Options } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css';
import { InfiniteDataSource, type TableLoadState, type TablePage } from './infinite-data-source';

type Sort = { field: string; dir: 'asc' | 'desc' };
export interface DataTableOptions<T extends object, R extends TablePage<T>> {
  columns: ColumnDefinition[];
  fetchPage: (page: number, size: number, sort: Sort | undefined, signal: AbortSignal) => Promise<R>;
  batchSize?: number;
  rowLabel?: string;
  index?: string;
  initialSort?: Sort;
  tableOptions?: Omit<Options, 'columns' | 'ajaxURL' | 'ajaxRequestFunc' | 'pagination' | 'progressiveLoad' | 'sortMode'>;
  onState?: (state: TableLoadState<T>) => void;
  onResponse?: (response: R) => void;
}

export function createDataTable<T extends object, R extends TablePage<T>>(root: HTMLElement, options: DataTableOptions<T, R>) {
  const host = root.querySelector<HTMLElement>('[data-table-host]')!;
  const status = root.querySelector<HTMLElement>('[data-table-status]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-table-more]')!;
  const error = root.querySelector<HTMLElement>('[data-table-error]')!;
  const skeleton = root.querySelector<HTMLElement>('[data-table-loading]')!;
  const number = new Intl.NumberFormat('en-BD');
  let sort = options.initialSort;
  let ready = false, destroyed = false, restoringSelection = false;
  let fillFrame = 0;
  const signature = (value: Sort | undefined) => value ? `${value.field}:${value.dir}` : '';
  const table = new Tabulator(host, {
    layout: 'fitColumns', height: 360, renderVertical: 'virtual', renderVerticalBuffer: 180,
    rowHeight: 52, movableColumns: true, columnHeaderSortMulti: false, dataLoader: false,
    ...options.tableOptions,
    selectableRowsPersistence: true,
    selectableRowsCheck: row => restoringSelection || (options.tableOptions?.selectableRowsCheck?.(row) ?? true),
    index: options.index ?? 'id', sortMode: 'remote',
    columns: options.columns.map(column => column.field === 'name'
      ? { ...column, headerHozAlign: 'left', hozAlign: 'left' }
      : column),
    initialSort: sort ? [{ column: sort.field, dir: sort.dir }] : undefined,
    columnDefaults: { headerWordWrap: true, headerHozAlign: 'center', hozAlign: 'center', vertAlign: 'middle', headerSortTristate: false, ...options.tableOptions?.columnDefaults },
  });
  const source = new InfiniteDataSource<T, R>({
    batchSize: options.batchSize ?? 50,
    key: row => (row as Record<string, string | number>)[options.index ?? 'id'],
    fetchPage: (page, size, signal) => options.fetchPage(page, size, sort, signal),
    render: async (rows, mode) => {
      if (destroyed) return;
      if (mode === 'append') await table.addData(rows);
      else if (mode === 'refresh') {
        const holder = host.querySelector<HTMLElement>('.tabulator-tableholder')!;
        const scrollTop = holder.scrollTop, scrollLeft = holder.scrollLeft;
        const selected = table.getSelectedData().map(row => row[options.index ?? 'id']);
        await table.replaceData(rows);
        holder.scrollTop = scrollTop; holder.scrollLeft = scrollLeft;
        const available = new Set(rows.map(row => (row as Record<string, string | number>)[options.index ?? 'id']));
        restoringSelection = true;
        try { table.selectRow(selected.filter(id => available.has(id))); } finally { restoringSelection = false; }
      } else { table.deselectRow(); await table.setData(rows); }
    },
    onResponse: options.onResponse,
    onState: state => {
      host.setAttribute('aria-busy', String(state.loading));
      skeleton.hidden = !state.loading || Boolean(state.rows.length);
      root.style.setProperty('--table-loading-top', `${host.querySelector<HTMLElement>('.tabulator-header')?.offsetHeight ?? 0}px`);
      if (!skeleton.hidden) {
        const columns = table.getColumns().filter(column => column.isVisible());
        for (const row of skeleton.querySelectorAll<HTMLElement>('.sk-row')) {
          row.style.gridTemplateColumns = columns.map(column => `${column.getWidth()}px`).join(' ');
          row.replaceChildren(...columns.map(() => { const bar = document.createElement('span'); bar.className = 'sk sk-value'; return bar; }));
        }
      }
      error.textContent = state.error ?? ''; error.hidden = !state.error;
      const count = `${number.format(state.rows.length)} of ${number.format(state.total)} ${options.rowLabel ?? 'rows'}`;
      status.textContent = state.loading ? state.rows.length ? `${count} · Loading…` : 'Loading…' : state.error ? state.rows.length ? count : 'Could not load rows' : state.total ? count : `0 ${options.rowLabel ?? 'rows'}`;
      more.hidden = !state.hasMore && !state.error;
      more.disabled = state.loading;
      more.setAttribute('aria-busy', String(state.loading));
      more.textContent = state.error ? 'Retry' : 'Load more';
      options.onState?.(state);
      if (!state.loading && !state.error) scheduleFill();
    },
  });
  function scheduleFill() {
    cancelAnimationFrame(fillFrame);
    if (destroyed || !ready) return;
    fillFrame = requestAnimationFrame(() => {
      const holder = host.querySelector<HTMLElement>('.tabulator-tableholder');
      const state = source.state;
      if (holder && holder.clientHeight > 0 && holder.scrollHeight - holder.clientHeight - holder.scrollTop < 180 && !state.loading && !state.error && state.hasMore) void source.loadMore();
    });
  }
  const observer = new ResizeObserver(scheduleFill);
  table.on('tableBuilt', () => {
    ready = true;
    const holder = host.querySelector<HTMLElement>('.tabulator-tableholder')!;
    holder.tabIndex = 0;
    holder.setAttribute('aria-label', host.getAttribute('aria-label') ?? 'Table rows');
    observer.observe(holder);
    for (const column of table.getColumns()) {
      if (column.getDefinition().headerSort === false) continue;
      const header = column.getElement();
      header.tabIndex = 0;
      header.addEventListener('keydown', event => {
        if (event.target !== header || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        const field = column.getField();
        const dir = sort?.field === field ? sort.dir === 'asc' ? 'desc' : 'asc' : column.getDefinition().headerSortStartingDir ?? 'asc';
        table.setSort(field, dir);
      });
    }
    void source.reset();
  });
  table.on('dataSorting', (sorters: Sort[]) => {
    const next = sorters[0];
    if (signature(next) === signature(sort)) return;
    sort = next;
    if (ready) queueMicrotask(() => { if (!destroyed) void source.reset(); });
  });
  table.on('scrollVertical', scheduleFill);
  more.addEventListener('click', () => void source.loadMore());
  const destroy = () => {
    if (destroyed) return;
    destroyed = true; source.destroy(); observer.disconnect(); cancelAnimationFrame(fillFrame); table.destroy();
    window.removeEventListener('pagehide', onPageHide);
  };
  const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) destroy(); };
  window.addEventListener('pagehide', onPageHide);
  return { table, source, reload: () => source.reset(), refresh: () => source.refresh(), destroy };
}
