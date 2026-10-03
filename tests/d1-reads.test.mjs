import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import ts from 'typescript';

const dir = await mkdtemp(join(tmpdir(), 'retarget-reads-'));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) db.exec(await readFile(`migrations/${file}`, 'utf8'));
let queries = [];
globalThis.__readsEnv = { DB: {
  prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; }, async all() {
      queries.push({ sql, args });
      return { results: db.prepare(sql).all(...args) };
    } };
  },
} };
for (const name of ['leads', 'campaign-audience', 'campaign-content', 'whatsapp-restrictions']) {
  const source = (await readFile(`src/lib/${name}.ts`, 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__readsEnv;');
  let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  compiled = compiled.replace(/from ['"]\.\/([^'"]+)['"]/g, "from './$1.mjs'").replace("from 'zod'", `from '${import.meta.resolve('zod')}'`);
  await writeFile(join(dir, `${name}.mjs`), compiled);
}
await writeFile(join(dir, 'lead-sync.mjs'), 'export const syncStatus = async () => [];');
await writeFile(join(dir, 'http.mjs'), 'export class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }');
const leads = await import(pathToFileURL(join(dir, 'leads.mjs')));
const { previewAudience } = await import(pathToFileURL(join(dir, 'campaign-audience.mjs')));
const { campaignAudienceInput } = await import(pathToFileURL(join(dir, 'campaign-content.mjs')));
after(async () => { db.close(); delete globalThis.__readsEnv; await rm(dir, { recursive: true, force: true }); });
const url = query => new URL(`https://example.com/api/leads?${query}`);
const lead = '11111111-1111-4111-8111-111111111111';
db.exec(`INSERT INTO leads(id,owner_id,phone,name,created_at) VALUES ('${lead}','admin','8801712345678','Amina',1);
INSERT INTO shipments(id,owner_id,lead_id,provider,shipment_id,raw_status,status,parcel_value_cents,delivered_at) VALUES
('s1','admin','${lead}','pathao','s1','Delivered','delivered',10000,10),
('s2','admin','${lead}','steadfast','s2','delivered','delivered',20000,20);`);

test('one audience aggregation supplies page, filtered count and unfiltered summary', async () => {
  queries = [];
  const result = await leads.listLeads('admin', url(''));
  assert.equal(queries.length, 1);
  assert.deepEqual(result.summary, { total: 1, eligible: 1, pathao: 1, steadfast: 1 });
  assert.equal(result.data[0].deliveryCount, 2);
  assert.equal(result.data[0].totalParcelValue, 300);
  assert.equal(result.data[0].averageParcelValue, 150);
  assert.equal(result.data[0].phone, '01712345678');
  assert.equal('filteredTotal' in result.data[0], false);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${queries[0].sql}`).all(...queries[0].args);
  assert.equal(plan.filter(row => row.detail === 'MATERIALIZE audience').length, 1);
});

test('empty pages retain accurate filtered totals and unfiltered summary', async () => {
  const page = await leads.listLeads('admin', url('page=2&size=1'));
  assert.deepEqual(page.data, []);
  assert.equal(page.last_row, 1);
  assert.equal(page.summary.total, 1);
  const filtered = await leads.listLeads('admin', url('search=missing'));
  assert.deepEqual(filtered.data, []);
  assert.equal(filtered.last_row, 0);
  assert.equal(filtered.last_page, 1);
  assert.equal(filtered.summary.total, 1);
  const empty = await leads.listLeads('other', url(''));
  assert.deepEqual(empty.data, []);
  assert.deepEqual(empty.summary, { total: 0, eligible: 0, pathao: 0, steadfast: 0 });
});

test('filtered counts and page rows share parameters without filtering summary totals', async () => {
  for (const query of ['search=Amina&source=pathao&eligibility=eligible&whatsapp=unknown', 'dates=known&from=1970-01-01&to=1970-01-01']) {
    const result = await leads.listLeads('admin', url(query));
    assert.equal(result.last_row, 1);
    assert.equal(result.data[0].id, lead);
  }
  const result = await leads.listLeads('admin', url('search=Amina&whatsapp=yes'));
  assert.equal(result.last_row, 0);
  assert.deepEqual(result.data, []);
  assert.equal(result.summary.total, 1);
});

test('frequent counters and empty WhatsApp work queues use targeted indexes', () => {
  const cases = [
    ["SELECT COUNT(*) FROM leads WHERE owner_id='admin' AND first_import_run_id='run'", 'leads_import_run'],
    ["SELECT id FROM leads WHERE owner_id='admin' AND whatsapp_exists IS NULL AND whatsapp_check_until <= unixepoch() LIMIT 1", 'leads_pending_whatsapp'],
    ["SELECT DISTINCT owner_id FROM leads WHERE whatsapp_exists IS NULL AND whatsapp_check_until <= unixepoch()", 'leads_pending_whatsapp'],
    ["SELECT shipment_id FROM shipments INDEXED BY shipments_unchecked_pathao WHERE owner_id='admin' AND provider='pathao' AND source_account_id='source' AND status IN ('delivered','partial') AND recipient_phone IS NOT NULL AND delivery_checked_at IS NULL ORDER BY shipment_id LIMIT 5", 'shipments_unchecked_pathao'],
    ["SELECT MAX(completed_at) FROM courier_sync_runs WHERE owner_id='admin' AND provider='pathao' AND status='complete'", 'courier_sync_completed'],
  ];
  for (const [sql, index] of cases) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    assert.ok(plan.some(row => row.detail.includes(index)), JSON.stringify(plan));
  }
});

test('campaign previews aggregate the audience once for all counts and page rows', async () => {
  queries = [];
  const result = await previewAudience('admin', campaignAudienceInput.parse({ whatsapp: 'all' }));
  assert.equal(queries.length, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(result.breakdown, { not_verified: 1 });
  assert.equal(result.incompleteChecks, 1);
  assert.equal(result.noWhatsappCount, 0);
  assert.equal(result.sample[0].phone, '01712345678');
  assert.equal('reason' in result.sample[0], false);
  assert.equal('incompleteChecks' in result.sample[0], false);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${queries[0].sql}`).all(...queries[0].args);
  assert.equal(plan.filter(row => row.detail === 'MATERIALIZE audience').length, 1);
  assert.equal(plan.filter(row => row.detail === 'MATERIALIZE selected').length, 1);
});
