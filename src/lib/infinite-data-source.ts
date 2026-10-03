export type TablePage<T> = { data: T[]; last_page: number; last_row: number };
export type TableLoadState<T> = {
  rows: T[]; total: number; page: number; hasMore: boolean; loading: boolean; error: string | null;
};
type LoadMode = 'reset' | 'append' | 'refresh';
export interface InfiniteDataSourceOptions<T, R extends TablePage<T>> {
  batchSize: number;
  key: (row: T) => string | number;
  fetchPage: (page: number, size: number, signal: AbortSignal) => Promise<R>;
  render: (rows: T[], mode: LoadMode) => Promise<unknown>;
  onState?: (state: TableLoadState<T>) => void;
  onResponse?: (response: R) => void;
}

export class InfiniteDataSource<T, R extends TablePage<T> = TablePage<T>> {
  private version = 0;
  private destroyed = false;
  private controller?: AbortController;
  private failedMode?: LoadMode;
  private pending?: Promise<boolean>;
  private value: TableLoadState<T> = { rows: [], total: 0, page: 0, hasMore: true, loading: false, error: null };

  constructor(private options: InfiniteDataSourceOptions<T, R>) {}
  get state() { return this.value; }
  private notify() { this.options.onState?.(this.value); }

  reset() {
    if (this.destroyed) return Promise.resolve(false);
    this.controller?.abort();
    this.version++;
    this.failedMode = undefined;
    this.value = { rows: [], total: 0, page: 0, hasMore: true, loading: false, error: null };
    return this.load('reset');
  }
  loadMore() {
    if (this.destroyed) return Promise.resolve(false);
    if (this.value.loading) return this.pending!;
    if (!this.value.hasMore && !this.value.error) return Promise.resolve(false);
    return this.load(this.value.error && this.failedMode ? this.failedMode : this.value.page ? 'append' : 'reset');
  }
  refresh() {
    if (this.destroyed) return Promise.resolve(false);
    if (this.value.loading) return this.pending!;
    return this.load(this.value.page ? 'refresh' : 'reset');
  }
  destroy() {
    this.destroyed = true;
    this.version++;
    this.controller?.abort();
  }
  private load(mode: LoadMode) {
    const version = this.version;
    const controller = new AbortController();
    this.controller = controller;
    this.value = { ...this.value, loading: true, error: null };
    this.notify();
    this.pending = this.perform(mode, version, controller);
    return this.pending;
  }
  private async perform(mode: LoadMode, version: number, controller: AbortController) {
    const current = () => version === this.version && !controller.signal.aborted;
    try {
      if (mode === 'reset') await this.options.render([], 'reset');
      let response: R | undefined;
      const batch: T[] = [];
      const first = mode === 'append' ? this.value.page + 1 : 1;
      let through = mode === 'refresh' ? this.value.page : first;
      let page = first;
      for (; page <= through; page++) {
        response = await this.options.fetchPage(page, this.options.batchSize, controller.signal);
        if (!current()) return false;
        batch.push(...response.data);
        through = Math.min(through, response.last_page);
      }
      if (!response || !current()) return false;
      const previous = mode === 'append' ? this.value.rows : [];
      const known = new Set(previous.map(this.options.key));
      const additions = batch.filter(row => {
        const key = this.options.key(row);
        if (known.has(key)) return false;
        known.add(key); return true;
      });
      const rows = [...previous, ...additions];
      await this.options.render(mode === 'append' ? additions : rows, mode);
      if (!current()) return false;
      this.failedMode = undefined;
      this.value = { rows, total: response.last_row, page: page - 1, hasMore: page - 1 < response.last_page, loading: true, error: null };
      this.options.onResponse?.(response);
      return true;
    } catch (error) {
      if (current()) {
        this.failedMode = mode;
        this.value = { ...this.value, error: error instanceof Error ? error.message : 'Could not load rows. Try again.' };
      }
      return false;
    } finally {
      if (current()) { this.value = { ...this.value, loading: false }; this.notify(); }
    }
  }
}
