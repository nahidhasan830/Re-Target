# Shared data table

Use `src/components/DataTable.astro` for the shell and `createDataTable` from `src/lib/data-table.ts` for client behavior. It supplies virtualized Tabulator rows, remote single-column sorting (including keyboard sorting), resizing/reordering, infinite loading, loaded/total counts, a keyboard-accessible Load more fallback, retries, request cancellation, duplicate-row protection, and shared dashboard styles. Each instance scopes its controls to its own root.

```astro
---
import DataTable from '../components/DataTable.astro';
---
<DataTable id="customers-table" label="Customers table" />
<script>
  import { createDataTable } from '../lib/data-table';
  type Customer = { id: string; name: string };
  const customers = createDataTable<Customer, {
    data: Customer[]; last_page: number; last_row: number;
  }>(document.querySelector('[data-table="customers-table"]')!, {
    columns: [{ title: 'Name', field: 'name', formatter: 'plaintext' }],
    initialSort: { field: 'name', dir: 'asc' },
    rowLabel: 'customers',
    fetchPage: async (page, size, sort, signal) => {
      const query = new URLSearchParams({ page: String(page), size: String(size) });
      if (sort) { query.set('sort', sort.field); query.set('direction', sort.dir); }
      const response = await fetch(`/api/customers?${query}`, { signal });
      if (!response.ok) throw new Error('Could not load customers. Try again.');
      return response.json();
    },
  });
</script>
```

The endpoint in this example is illustrative. Supply an account-scoped endpoint returning `data`, `last_page` (at least 1), and `last_row` (filtered total). Keep a stable sort with a unique-key tie breaker. Rows must have a unique `id`, or configure `index` to another unique field. Batch size defaults to 50 and remains fixed while browsing. Leads uses 25 on mobile and 50 on desktop; its API still accepts bounded page requests.

Call `reload()` after changing external filters; it cancels pending requests, clears selection, and starts at the first batch. Call `refresh()` to re-fetch the loaded batches while preserving scroll and surviving selections. A failed append or refresh keeps existing rows and retries the same operation. `source.state` exposes rows, total, page, loading, error, and whether more batches remain. `onState` and `onResponse` connect page-specific controls and metadata; additional response properties are preserved through the generic response type.

Use `tableOptions` for Tabulator selection, height, and column defaults; use the returned `table` for visibility, detail actions, and layout changes. Infinite loading owns data and remote sorting: do not configure a second AJAX loader, pagination, or progressive loader. Formatting, external filter forms, domain-specific actions, and the optional `empty` slot belong to the consuming page. Use `formatter: 'plaintext'` or DOM nodes with `textContent` for untrusted strings.

The underlying loader lives in `src/lib/infinite-data-source.ts` and has regression tests for concurrent scroll requests, failed batches, filter races, duplicate rows, refreshes, empty results, and disposal. Destruction cancels pending requests and disconnects observers. Normal page departure destroys the table; browser back/forward cache preserves it. Call `destroy()` when removing an instance yourself.

Campaign audience also uses this component, with a POST preview adapter returning the shared response shape. It uses 25 rows on mobile and 50 on desktop, hides the contact/delivery/value columns on mobile, and disables sorting and row selection. Campaign membership follows the full filtered audience rather than the loaded table rows.
