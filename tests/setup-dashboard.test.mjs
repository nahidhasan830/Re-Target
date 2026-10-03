import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const db = new DatabaseSync(':memory:');
for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) db.exec(await readFile(`migrations/${file}`, 'utf8'));
let queries = [];
globalThis.__setupEnv = { DB: { prepare(sql) {
  let args;
  return { bind(...values) { args = values; return this; }, async first() { queries.push({ sql, args }); return db.prepare(sql).get(...args); } };
} } };
async function load(path, mock = false) {
  const source = (await readFile(path, 'utf8')).replace("import { env } from 'cloudflare:workers';", mock ? 'const env = globalThis.__setupEnv;' : '');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { setupProgress } = await load('src/lib/setup-dashboard.ts', true);
const { setupGuide } = await load('src/lib/setup-guide.ts');
const account = { id: 'shop-a', role: 'user', phone: '01712345678', companyName: 'Ready Cart', credentialVersion: 1 };
const empty = { companyName: 'Ready Cart', whatsapp: false, courier: false, leads: false, media: false, campaign: false, importing: false };
beforeEach(() => {
  db.exec('DELETE FROM campaigns; DELETE FROM campaign_assets; DELETE FROM shipments; DELETE FROM leads; DELETE FROM courier_sync_runs; DELETE FROM courier_credentials; DELETE FROM whatsapp_connections;');
  queries = [];
});
after(() => { db.close(); delete globalThis.__setupEnv; });

function seed(owner = 'shop-a') {
  db.prepare("INSERT INTO whatsapp_connections(owner_id,session_name,status,phone) VALUES (?,?,'WORKING','01712345678')").run(owner, owner);
  db.prepare("INSERT INTO courier_credentials(owner_id,provider,encrypted_credentials,encrypted_session,updated_at) VALUES (?,'pathao','credentials','session',1)").run(owner);
  db.prepare("INSERT INTO leads(id,owner_id,phone,name,created_at) VALUES ('lead-1',?,'8801712345678','Amina',1)").run(owner);
  db.prepare("INSERT INTO shipments(id,owner_id,lead_id,provider,shipment_id,raw_status,status) VALUES ('shipment-1',?,'lead-1','pathao','parcel-1','Delivered','delivered')").run(owner);
  db.prepare("INSERT INTO campaign_assets(id,owner_id,original_name,original_key,kind,mime,bytes,checksum,state,library_saved,created_at) VALUES ('asset-1',?,'Offer','offer','image','image/jpeg',100,'hash','ready',1,1)").run(owner);
  db.prepare("INSERT INTO campaigns(id,owner_id,name,status,content_json,audience_json,company_name,sender_phone,launch_status,created_at,updated_at) VALUES ('campaign-1',?,'Offer','scheduled','{}','{}','Ready Cart','01712345678','scheduled',1,1)").run(owner);
}

test('an invited business starts with company details complete and WhatsApp next', async () => {
  const progress = await setupProgress(account);
  assert.deepEqual(progress, empty);
  const guide = setupGuide(progress, '/app');
  assert.equal(guide.completed, 1);
  assert.equal(guide.total, 5);
  assert.equal(guide.next.id, 'whatsapp');
  assert.equal(guide.next.href, '/app/whatsapp');
  assert.equal(queries.length, 1);
});

test('progress belongs to the authenticated owner, using one bounded read', async () => {
  seed('shop-b');
  assert.deepEqual(await setupProgress(account), empty);
  assert.deepEqual(await setupProgress({ ...account, id: 'shop-b' }), { ...empty, whatsapp: true, courier: true, leads: true, media: true, campaign: true });
  assert.deepEqual(queries.map(query => query.args), [['shop-a'], ['shop-b']]);
  assert.ok(queries.every(query => query.sql.startsWith('SELECT') && !query.sql.includes('COUNT(')));
});

test('optional media never blocks campaign creation or completing setup', async () => {
  seed();
  db.exec('DELETE FROM campaign_assets;');
  const progress = await setupProgress(account);
  const guide = setupGuide(progress, '/app');
  assert.equal(guide.complete, true);
  assert.equal(guide.completed, 5);
  assert.equal(guide.steps.find(step => step.id === 'media').complete, false);
  const unlaunched = setupGuide({ ...progress, campaign: false }, '/app');
  assert.equal(unlaunched.next.id, 'campaign');
  assert.equal(unlaunched.next.href, '/app/campaigns/new');
});

test('saved credentials, disconnected WhatsApp, unprepared assets and draft/test campaigns do not earn checks', async () => {
  seed();
  db.exec("UPDATE whatsapp_connections SET status='STOPPED'; UPDATE courier_credentials SET encrypted_session=NULL; UPDATE campaign_assets SET state='processing'; UPDATE campaigns SET status='draft',sender_phone=NULL,launch_status=NULL;");
  let progress = await setupProgress(account);
  assert.equal(progress.whatsapp, false);
  assert.equal(progress.courier, false);
  assert.equal(progress.media, false);
  assert.equal(progress.campaign, false);
  db.exec("UPDATE courier_credentials SET encrypted_session='session',auth_error='Reconnect'; UPDATE campaigns SET is_test=1,sender_phone='01712345678',launch_status='running';");
  progress = await setupProgress(account);
  assert.equal(progress.courier, false);
  assert.equal(progress.campaign, false);
  db.exec("UPDATE whatsapp_connections SET status='WORKING',phone=NULL; UPDATE campaign_assets SET state='ready',library_saved=0;");
  progress = await setupProgress(account);
  assert.equal(progress.whatsapp, false);
  assert.equal(progress.media, false);
});

test('only qualifying delivered leads complete import; a queued import shows its pending state', async () => {
  seed();
  db.exec("UPDATE shipments SET status='pending'; INSERT INTO courier_sync_runs(id,owner_id,provider,credential_version,trigger,status,started_at,updated_at) VALUES ('run','shop-a','pathao',0,'connect','queued',1,1);");
  let progress = await setupProgress(account);
  assert.equal(progress.leads, false);
  assert.equal(progress.importing, true);
  const next = setupGuide(progress, '/app').next;
  assert.equal(next.id, 'leads');
  assert.equal(next.action, 'Check import');
  db.exec("UPDATE shipments SET status='partial',provider='steadfast';");
  assert.equal((await setupProgress(account)).leads, false);
  db.exec("UPDATE shipments SET provider='pathao';");
  assert.equal((await setupProgress(account)).leads, true);
});

test('a disconnected dependency becomes the next task even after the first campaign', async () => {
  seed();
  assert.equal(setupGuide(await setupProgress(account), '/app').complete, true);
  db.exec("UPDATE whatsapp_connections SET status='FAILED';");
  const guide = setupGuide(await setupProgress(account), '/app');
  assert.equal(guide.complete, false);
  assert.equal(guide.next.id, 'whatsapp');
  assert.equal(guide.steps.find(step => step.id === 'campaign').complete, true);
  assert.equal(setupGuide({ ...empty, companyName: '' }, '/admin').next.href, '/admin/account');
});
