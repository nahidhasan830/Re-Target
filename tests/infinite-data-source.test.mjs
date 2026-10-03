import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compiled = ts.transpileModule(await readFile('src/lib/infinite-data-source.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { InfiniteDataSource } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const page = (ids, last = 3, total = 6) => ({ data: ids.map(id => ({ id })), last_page: last, last_row: total });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(fetchPage) {
  const renders = [];
  const source = new InfiniteDataSource({ batchSize: 2, key: row => row.id, fetchPage, render: async (rows, mode) => renders.push({ rows: rows.map(row => row.id), mode }) });
  return { source, renders };
}

test('scroll requests coalesce, append unique rows and stop at the end', async () => {
  const next = deferred(), calls = [];
  const { source, renders } = fixture(async n => { calls.push(n); return n === 1 ? page([1, 2]) : n === 2 ? next.promise : page([4, 5], 3, 5); });
  await source.reset();
  const a = source.loadMore(), b = source.loadMore();
  assert.equal(a, b);
  next.resolve(page([2, 3])); await a;
  assert.deepEqual(renders.at(-1), { rows: [3], mode: 'append' });
  await source.loadMore(); await source.loadMore();
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(source.state.rows.map(row => row.id), [1, 2, 3, 4, 5]);
  assert.equal(source.state.hasMore, false);
});

test('a failed next batch preserves existing rows and retry requests the same page', async () => {
  let fail = true; const calls = [];
  const { source } = fixture(async n => { calls.push(n); if (n === 2 && fail) { fail = false; throw new Error('Offline'); } return page(n === 1 ? [1, 2] : [3, 4]); });
  await source.reset(); await source.loadMore();
  assert.deepEqual(source.state.rows.map(row => row.id), [1, 2]);
  assert.equal(source.state.error, 'Offline'); assert.equal(source.state.page, 1);
  await source.loadMore();
  assert.deepEqual(calls, [1, 2, 2]); assert.equal(source.state.error, null);
});

test('filter reset aborts a pending batch and ignores its stale response', async () => {
  const old = deferred(); let signal, filtered = false;
  const { source, renders } = fixture(async (n, _size, requestSignal) => {
    if (filtered) return page([9], 1, 1);
    if (n === 1) return page([1, 2]);
    signal = requestSignal; return old.promise;
  });
  await source.reset(); const pending = source.loadMore(); filtered = true;
  await source.reset(); assert.equal(signal.aborted, true);
  old.resolve(page([3, 4])); await pending;
  assert.deepEqual(source.state.rows.map(row => row.id), [9]);
  assert.equal(source.state.total, 1);
  assert.ok(!renders.some(render => render.rows.includes(3)));
});

test('background refresh replaces the loaded prefix and handles a shrinking result', async () => {
  let shrinking = false; const calls = [];
  const { source, renders } = fixture(async n => { calls.push(n); return shrinking ? page([8], 1, 1) : page(n === 1 ? [1, 2] : [3, 4]); });
  await source.reset(); await source.loadMore();
  await source.refresh();
  assert.deepEqual(calls, [1, 2, 1, 2]);
  assert.deepEqual(renders.at(-1), { rows: [1, 2, 3, 4], mode: 'refresh' });
  shrinking = true; await source.refresh();
  assert.deepEqual(source.state.rows.map(row => row.id), [8]);
  assert.equal(source.state.page, 1); assert.equal(source.state.hasMore, false);
});

test('retrying a failed refresh repeats the refresh instead of skipping to the next batch', async () => {
  let fail = false; const calls = [];
  const { source } = fixture(async n => { calls.push(n); if (fail && n === 2) throw new Error('Offline'); return page(n === 1 ? [1, 2] : [3, 4], 2, 4); });
  await source.reset(); await source.loadMore(); fail = true;
  await source.refresh(); assert.equal(source.state.error, 'Offline');
  assert.deepEqual(source.state.rows.map(row => row.id), [1, 2, 3, 4]);
  fail = false; await source.loadMore();
  assert.deepEqual(calls, [1, 2, 1, 2, 1, 2]); assert.equal(source.state.error, null);
});

test('empty data completes and destruction prevents pending data from rendering', async () => {
  const empty = fixture(async () => page([], 1, 0)).source;
  await empty.reset(); assert.equal(empty.state.hasMore, false); assert.equal(empty.state.total, 0);
  const delayed = deferred(); const { source, renders } = fixture(() => delayed.promise);
  const pending = source.reset(); await Promise.resolve(); source.destroy();
  delayed.resolve(page([1, 2])); await pending;
  assert.ok(!renders.some(render => render.rows.length));
  assert.equal(await source.loadMore(), false);
  assert.equal(await source.reset(), false);
});
