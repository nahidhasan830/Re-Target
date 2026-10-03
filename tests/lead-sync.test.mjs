import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';
import ts from 'typescript';
const dir = await mkdtemp(join(tmpdir(), 'retarget-sync-'));
for (const name of ['lead-sync','courier-parcels','http']) {
  let source = await readFile(`src/lib/${name}.ts`, 'utf8');
  source = source.replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__syncEnv;');
  let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  compiled = compiled.replace(/from ['"]\.\/([^'"]+)['"]/g, "from './$1.mjs'");
  for (const library of ['zod','htmlparser2','domutils','domhandler']) compiled = compiled.replace(`from '${library}'`, `from '${import.meta.resolve(library)}'`);
  await writeFile(join(dir, `${name}.mjs`), compiled);
}
await writeFile(join(dir,'lead-whatsapp.mjs'), 'export const enqueueWhatsAppChecks = async owner => globalThis.__whatsappJobs.push(owner);');
await writeFile(join(dir,'auth.mjs'), "export const adminCredentials = async () => ({phone:'01700000000',companyName:'Test',hash:'hash'}); export const digest = async()=> 'version';");
await writeFile(join(dir,'courier-auth.mjs'), 'export const courierText = async response => response.text();');
await writeFile(join(dir,'courier-sessions.mjs'), "export const courierRead = (...args) => args[1] === 'pathao' && args[2].includes('/activity?') ? globalThis.__syncActivity(...args) : globalThis.__syncRead(...args); export const verifyCourier = (...args) => globalThis.__syncVerify(...args);");
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const migrations = (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort();
for (const file of migrations.filter(file => file < '0007')) db.exec(await readFile(`migrations/${file}`, 'utf8'));
db.exec("INSERT INTO leads (id,owner_id,phone,name,created_at) VALUES ('legacy-lead','admin','8801700000000','Legacy',1); INSERT INTO shipments (id,owner_id,lead_id,provider,shipment_id,raw_status,status) VALUES ('legacy-shipment','admin','legacy-lead','pathao','OLD','Delivered','delivered');");
db.exec(await readFile(`migrations/${migrations.find(file => file.startsWith('0007'))}`, 'utf8'));
assert.equal(db.prepare("SELECT source_account_id FROM shipments WHERE id='legacy-shipment'").get().source_account_id,'legacy');
assert.equal(db.prepare("SELECT name FROM leads WHERE id='legacy-lead'").get().name,'Legacy');
for (const file of migrations.filter(file => file >= '0008')) db.exec(await readFile(`migrations/${file}`, 'utf8'));
assert.equal(db.prepare("SELECT whatsapp_exists FROM leads WHERE id='legacy-lead'").get().whatsapp_exists, null);
assert.equal(db.prepare("SELECT parcel_value_cents FROM shipments WHERE id='legacy-shipment'").get().parcel_value_cents, null);
const binding = { prepare(sql) { let args = []; return { bind(...values) { args=values; return this; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return {results:db.prepare(sql).all(...args)}; }, async run() { return db.prepare(sql).run(...args); } }; }, async batch(values) { db.exec('BEGIN'); try { const result=[]; for (const value of values) result.push(await value.run()); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } } };
let jobs=[], calls=[]; globalThis.__whatsappJobs = [];
globalThis.__syncEnv = {DB:binding,LEAD_SYNC:{ async send(message) { jobs.push(message); } }};
const sync = await import(pathToFileURL(join(dir,'lead-sync.mjs')));
const parser = await import(pathToFileURL(join(dir,'courier-parcels.mjs')));
const owner = {id:'admin',role:'admin'};
const pathao = (rows, page=1,last=1,total=rows.length) => JSON.stringify({code:200,data:{data:rows,current_page:page,last_page:last,total}});
const activity = (id, events=[{desc:'Delivered.',created_at:'Oct 1, 2026 5:49 PM'}]) => JSON.stringify({code:200,data:{log:events.map(event=>({consignment_id:id,...event}))}});
const row = (id,phone='01712345678',status='Delivered')=>({amount_to_collect:1500.25,order_consignment_id:id,recipient_name:'Customer',recipient_phone:phone,recipient_address:'Dhaka',order_status:status,order_created_at:'2026-09-01 10:00:00',order_status_updated_at:'2026-09-02 12:00:00'});
const list = (id='123', next='')=>`<script>window.Steadfast={"user_id":20}</script><main><table><thead><tr>${['Consignment','Invoice','Recipient','Address','Status'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody><tr><td><a href="https://steadfast.com.bd/user/consignment/${id}">${id}</a></td><td>INV</td><td>Customer</td><td>Dhaka</td><td><span class="sf-badge">Delivered</span><span class="sf-badge">Cleared</span></td></tr></tbody></table>${next?`<a rel="next" href="${next}">Next</a>`:''}</main>`;
const detail = (id='123',phone='01712345678')=>`<main><h1>Parcel #${id}</h1><section class="sf-parcel__card--recipient"><div class="sf-parcel__person"><b>Customer</b><p>Dhaka</p><p class="sf-parcel__area">Area</p></div><ul class="sf-parcel__contacts"><li><span class="sf-parcel__contact-label">Phone</span><span class="sf-parcel__mono">${phone}</span></li></ul></section><dl><dt>COD</dt><dd>৳ 1,500.25</dd><dt>Tracking code</dt> \n<dd>TRACK</dd><dt>Created</dt><dd>22 Aug 2026, 07:42 PM</dd></dl><ul><li><span class="sf-parcel__step">Consignment has been marked as delivered by rider.</span><time datetime="2026-09-01T10:00:00+06:00"></time></li></ul></main>`;
async function seed(provider='pathao',id='admin') { db.prepare('INSERT INTO courier_credentials(owner_id,provider,encrypted_credentials,encrypted_session,updated_at) VALUES (?,?,?,?,1)').run(id,provider,'encrypted','session'); }
async function drain() { for(let i=0;jobs.length;i++) {assert.ok(i<100); await sync.processSync(jobs.shift());} }
beforeEach(()=>{db.exec('DELETE FROM shipments; DELETE FROM leads; DELETE FROM courier_sync_runs; DELETE FROM courier_credentials; DELETE FROM users;');jobs=[];calls=[];globalThis.__whatsappJobs=[];globalThis.__activityCalls=[];globalThis.__syncActivity=async(account,provider,path)=>{globalThis.__activityCalls.push({owner:account.id,path});return new Response(activity(path.split('/')[4]));};globalThis.__syncVerify=async(_account,provider)=>provider==='pathao'?'10':'20';globalThis.__syncRead=async(account,provider,path)=>{calls.push({owner:account.id,provider,path});return new Response(provider==='pathao'?pathao([]):list());};});
after(async()=>{db.close();await rm(dir,{recursive:true,force:true});delete globalThis.__syncEnv;delete globalThis.__syncRead;delete globalThis.__syncVerify;delete globalThis.__syncActivity;delete globalThis.__activityCalls;});
test('phone normalization and parsers enforce source shape and preserve source dates',()=>{assert.equal(parser.courierPhone('+880 1712-345678'),'8801712345678');assert.equal(parser.courierPhone('০১৭১২৩৪৫৬৭৮'),'8801712345678');assert.equal(parser.courierPhone('01712 bad'),null);assert.throws(()=>parser.parseSteadfastList('<main>Login</main>','/user/consignment/status/delivered'));assert.throws(()=>parser.steadfastPath('https://evil.test/user/consignment/status/delivered'));assert.throws(()=>parser.steadfastPath('/user/consignment/status/delivered?page=2'));const parsed=parser.parseSteadfastDetail(detail(),parser.parseSteadfastList(list(),'/user/consignment/status/delivered').parcels[0]);assert.equal(parsed.phone,'8801712345678');assert.equal(parsed.trackingCode,'TRACK');assert.equal(parsed.createdAt,parser.sourceDate('2026-08-22T19:42:00+06:00'));assert.equal(parsed.deliveredAt,parser.sourceDate('2026-09-01T10:00:00+06:00'));});
test('Pathao imports every page and archive with partials; duplicate jobs and runs are idempotent',async()=>{await seed();globalThis.__syncRead=async(_account,_provider,path)=>{calls.push(path);const u=new URL(path,'https://merchant.pathao.com');return new Response(u.searchParams.get('archive')==='1'?pathao([row('ARCHIVED','01812345678')]):u.searchParams.get('page')==='1'?pathao([row('A'),row('B','01712345678','Partial Delivery')],1,2,3):pathao([row('C','invalid')],2,2,3));};const id=await sync.startSync(owner,'pathao');assert.equal(await sync.startSync(owner,'pathao'),id);const duplicate={...jobs[0]};await drain();await sync.processSync(duplicate);assert.equal(calls.length,3);assert.deepEqual(globalThis.__whatsappJobs,['admin']);assert.equal(db.prepare("SELECT parcel_value_cents FROM shipments WHERE shipment_id='A'").get().parcel_value_cents,150025);assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM shipments').get().n,4);assert.equal((await sync.syncStatus('admin'))[0].status,'complete');assert.equal((await sync.syncStatus('admin'))[0].skipped,1);db.exec('UPDATE leads SET excluded=1');await sync.startSync(owner,'pathao');await drain();assert.equal(db.prepare('SELECT SUM(excluded) n FROM leads').get().n,2);assert.equal((await sync.syncStatus('admin'))[0].newLeads,0);});
test('Steadfast traverses known IDs and fetches details only for new IDs, with cross-courier deduplication',async()=>{await seed();globalThis.__syncRead=async(_account,_provider,path)=>new Response(path.includes('archive=1')?pathao([]):pathao([row('P')]));await sync.startSync(owner,'pathao');await drain();await seed('steadfast');globalThis.__syncRead=async(_account,_provider,path)=>{calls.push(path);return new Response(path.includes('/status/')?list():detail());};await sync.startSync(owner,'steadfast');await drain();assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM shipments').get().n,2);assert.equal(calls.filter(path=>path==='/user/consignment/123').length,1);globalThis.__syncRead=async(_account,_provider,path)=>{calls.push(path);return new Response(path.includes('/status/')?(path.includes('cursor=')?list('456'):list('123','/user/consignment/status/delivered?cursor=next')):detail('456','01812345678'));};await sync.startSync(owner,'steadfast');await drain();assert.equal(calls.filter(path=>path==='/user/consignment/123').length,1);assert.equal(calls.filter(path=>path==='/user/consignment/456').length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,2);});
test('retries retain discovered consignments and finished details',async()=>{await seed('steadfast');let fail=true;globalThis.__syncRead=async(_account,_provider,path)=>{if(path.includes('/status/'))return new Response(list());if(fail){fail=false;throw new Error('sensitive upstream details');}return new Response(detail());};const id=await sync.startSync(owner,'steadfast');await sync.processSync(jobs.shift());const retry=jobs.shift();await assert.rejects(sync.processSync(retry));assert.equal(db.prepare('SELECT details_status FROM shipments').get().details_status,'pending');assert.ok(!db.prepare('SELECT error FROM courier_sync_runs').get().error.includes('sensitive'));await sync.processSync(retry);await drain();assert.equal(db.prepare('SELECT status FROM courier_sync_runs WHERE id=?').get(id).status,'complete');});
test('credential changes during upstream reads fence out old writes',async()=>{await seed();globalThis.__syncRead=async()=>{db.exec("UPDATE courier_credentials SET credential_version=1 WHERE owner_id='admin'");return new Response(pathao([row('STALE')]));};const id=await sync.startSync(owner,'pathao');await drain();assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM shipments').get().n,0);globalThis.__syncRead=async()=>new Response(pathao([]));await sync.startSync(owner,'pathao');assert.equal(db.prepare('SELECT status FROM courier_sync_runs WHERE id=?').get(id).status,'superseded');await drain();});
test('same phone and consignment stay isolated per owner, with composite foreign key',async()=>{db.prepare("INSERT INTO users(id,phone,company_name,password_hash,created_at) VALUES ('business','01800000000','Business','hash',1)").run();await seed();await seed('pathao','business');globalThis.__syncRead=async(account,_provider,path)=>{calls.push(account.id);return new Response(path.includes('archive=1')?pathao([]):pathao([row('SAME')]));};await sync.startSync(owner,'pathao');await drain();await sync.startSync({id:'business',role:'user'},'pathao');await drain();assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,2);assert.equal((await sync.syncStatus('business'))[0].newLeads,1);const adminLead=db.prepare("SELECT id FROM leads WHERE owner_id='admin'").get().id;assert.throws(()=>db.prepare("UPDATE shipments SET lead_id=? WHERE owner_id='business'").run(adminLead),/FOREIGN KEY/);assert.ok(calls.includes('business'));});
test('cron recovers a lost queue dispatch and starts connected accounts automatically',async()=>{await seed();await sync.scheduledSync();assert.equal(jobs.length,1);jobs=[];db.exec('UPDATE courier_sync_runs SET dispatched_at=0');await sync.scheduledSync();assert.equal(jobs.length,1);await drain();assert.equal((await sync.syncStatus('admin'))[0].status,'complete');});

test('automatic imports wait twelve hours, while manual imports remain immediate', async () => {
  const originalNow = Date.now;
  const timestamp = Math.floor(originalNow() / 1000);
  Date.now = () => timestamp * 1000;
  try {
    await seed();
    await sync.scheduledSync(); await drain();
    db.prepare('UPDATE courier_sync_runs SET started_at = ?').run(timestamp - 12 * 3600 + 1);
    await sync.scheduledSync();
    assert.equal(jobs.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM courier_sync_runs').get().n, 1);
    db.prepare('UPDATE courier_sync_runs SET started_at = ?').run(timestamp - 12 * 3600);
    await sync.scheduledSync();
    assert.equal(jobs.length, 1);
    await drain();
    await sync.scheduledSync(); assert.equal(jobs.length, 0);
    await sync.startSync(owner, 'pathao'); assert.equal(jobs.length, 1);
    await drain();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM courier_sync_runs').get().n, 3);
  } finally { Date.now = originalNow; }
});

test('pending counters include detail and activity work once and exclude other merchants', async () => {
  await seed(); await seed('steadfast');
  for (const [provider, source] of [['pathao', '10'], ['steadfast', '20']]) {
    db.prepare("INSERT INTO courier_sync_runs(id,owner_id,provider,credential_version,source_account_id,trigger,status,started_at,updated_at) VALUES (?,'admin',?,0,?,'manual','complete',1,1)").run(provider, provider, source);
  }
  const insert = db.prepare("INSERT INTO shipments(id,owner_id,provider,source_account_id,shipment_id,raw_status,status,details_status,recipient_phone,delivery_checked_at) VALUES (?,'admin',?,?,?,?,?,?,?,?)");
  insert.run('detail', 'pathao', '10', 'detail', 'Pending', 'pending', 'pending', null, null);
  insert.run('both', 'pathao', '10', 'both', 'Delivered', 'delivered', 'pending', '8801712345678', null);
  insert.run('activity', 'pathao', '10', 'activity', 'Partial Delivery', 'partial', 'complete', '8801712345678', null);
  insert.run('checked', 'pathao', '10', 'checked', 'Delivered', 'delivered', 'complete', '8801712345678', 1);
  insert.run('other-source', 'pathao', 'other', 'other-source', 'Delivered', 'delivered', 'pending', '8801712345678', null);
  insert.run('steadfast', 'steadfast', '20', 'steadfast', 'delivered', 'delivered', 'pending', null, null);
  const status = await sync.syncStatus('admin');
  assert.equal(status[0].pending, 3);
  assert.equal(status[1].pending, 1);
});

test('relay compaction preserves the unified parcel data and cursor', async () => {
  const {compactSteadfast} = await import('../infra/steadfast-transport/parser.mjs');
  const path='/user/consignment/status/delivered';
  const original=list('123', path+'?cursor=next');
  assert.deepEqual(parser.parseSteadfastList(compactSteadfast(original,path),path),parser.parseSteadfastList(original,path));
  const saved=parser.parseSteadfastList(original,path).parcels[0];
  const html=detail();
  assert.deepEqual(parser.parseSteadfastDetail(compactSteadfast(html,'/user/consignment/123'),saved),parser.parseSteadfastDetail(html,saved));
  assert.throws(()=>compactSteadfast('<main>Unexpected markup</main>',path));
});

test('parcel amounts distinguish zero, missing, malformed and decimal COD amounts',()=>{assert.equal(parser.parcelValue('৳ 1,234.50'),123450);assert.equal(parser.parcelValue('BDT ০.০০'),0);for(const value of [null,'',-1,'unknown','NaN','12.345'])assert.equal(parser.parcelValue(value),null);const saved=parser.parseSteadfastList(list(),'/user/consignment/status/delivered').parcels[0];assert.equal(parser.parseSteadfastDetail(detail(),saved).parcelValueCents,150025);});


test('Pathao activity uses the explicit delivery event in Bangladesh time and validates parcel identity',()=>{
 const parcel=parser.parsePathao(pathao([row('P')]),1,0).parcels[0];
 assert.equal(parcel.createdAt,parser.sourceDate('2026-09-01T10:00:00Z'));
 assert.equal(parser.parsePathaoActivity(activity('P'),parcel),parser.sourceDate('2026-10-01T17:49:00+06:00'));
 assert.equal(parser.parsePathaoActivity(activity('P',[{desc:'Assigned for delivery.',created_at:'Oct 1, 2026 5:49 PM'}]),parcel),null);
 assert.equal(parser.parsePathaoActivity(activity('P',[]),parcel),null);
 assert.equal(parser.parsePathaoActivity(activity('P',[{desc:'Delivered.',created_at:'Oct 1, 2026 12:00 AM'},{desc:'Delivered.',created_at:'Oct 1, 2026 12:00 PM'}]),parcel),parser.sourceDate('2026-10-01T12:00:00+06:00'));
 for(const body of [activity('OTHER'),activity('P',[{desc:'Delivered.',created_at:'Feb 30, 2026 5:49 PM'}]),activity('P',[{desc:'Delivered.',created_at:'Oct 1, 2026 13:49 PM'}]),JSON.stringify({code:200,data:{}})])assert.throws(()=>parser.parsePathaoActivity(body,parcel));
 assert.equal(parser.pathaoActivityPath({...parcel,sourceArchive:1}),'/api/v1/orders/P/01712345678/activity?archive=1');
});

test('Pathao backfills imported parcels, remembers completed checks and refreshes changed statuses',async()=>{
 await seed();let stamp='2026-09-02 12:00:00';
 globalThis.__syncRead=async(_account,_provider,path)=>new Response(path.includes('archive=1')?pathao([]):pathao([{...row('P'),order_status_updated_at:stamp}]));
 await sync.startSync(owner,'pathao');await drain();
 let saved=db.prepare("SELECT delivered_at,delivery_checked_at FROM shipments WHERE shipment_id='P'").get();
 assert.equal(saved.delivered_at,parser.sourceDate('2026-10-01T17:49:00+06:00'));assert.ok(saved.delivery_checked_at);
 db.exec('UPDATE shipments SET delivery_checked_at=NULL,delivered_at=NULL');
 await sync.startSync(owner,'pathao');await drain();assert.equal(globalThis.__activityCalls.length,2);
 await sync.startSync(owner,'pathao');await drain();assert.equal(globalThis.__activityCalls.length,2);
 stamp='2026-10-02 10:00:00';await sync.startSync(owner,'pathao');await drain();assert.equal(globalThis.__activityCalls.length,3);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,1);
});

test('Pathao history retains missing dates without looping and uses the archive feed',async()=>{
 await seed();globalThis.__syncRead=async(_account,_provider,path)=>new Response(path.includes('archive=1')?pathao([row('OLD')]):pathao([]));
 globalThis.__syncActivity=async(_account,_provider,path)=>{globalThis.__activityCalls.push(path);return new Response(activity('OLD',[]));};
 await sync.startSync(owner,'pathao');await drain();assert.deepEqual(globalThis.__activityCalls,['/api/v1/orders/OLD/01712345678/activity?archive=1']);
 assert.equal(db.prepare('SELECT delivered_at FROM shipments').get().delivered_at,null);
 assert.ok(db.prepare('SELECT delivery_checked_at FROM shipments').get().delivery_checked_at);
 await sync.startSync(owner,'pathao');await drain();assert.equal(globalThis.__activityCalls.length,1);
});

test('Pathao history batches persist finished dates across retry and fence stale credential writes',async()=>{
 await seed();globalThis.__syncRead=async(_account,_provider,path)=>new Response(path.includes('archive=1')?pathao([]):pathao(Array.from({length:7},(_,i)=>row('P'+i))));
 let fail=true;globalThis.__syncActivity=async(_account,_provider,path)=>{const id=path.split('/')[4];if(id==='P1'&&fail){fail=false;throw Error('upstream');}return new Response(activity(id));};
 await sync.startSync(owner,'pathao');await sync.processSync(jobs.shift());await sync.processSync(jobs.shift());
 const retry=jobs.shift();await assert.rejects(sync.processSync(retry));assert.equal(db.prepare('SELECT COUNT(*) n FROM shipments WHERE delivery_checked_at IS NOT NULL').get().n,1);
 await sync.processSync(retry);assert.equal(db.prepare('SELECT COUNT(*) n FROM shipments WHERE delivery_checked_at IS NOT NULL').get().n,6);
 await drain();assert.equal(db.prepare('SELECT COUNT(*) n FROM shipments WHERE delivered_at IS NOT NULL').get().n,7);
 db.exec('UPDATE shipments SET delivery_checked_at=NULL,delivered_at=NULL');
 globalThis.__syncActivity=async(_account,_provider,path)=>{db.exec('UPDATE courier_credentials SET credential_version=credential_version+1');return new Response(activity(path.split('/')[4]));};
 await sync.startSync(owner,'pathao');await drain();assert.equal(db.prepare('SELECT COUNT(*) n FROM shipments WHERE delivery_checked_at IS NOT NULL').get().n,0);
});


test('Pathao partial delivery dates come from the matching confirmed event and are backfilled once',async()=>{
 const partial=parser.parsePathao(pathao([row('PARTIAL','01712345678','Partial Delivery')]),1,0).parcels[0];
 const body=activity('PARTIAL',[{desc:'Assigned for delivery.',created_at:'Sep 6, 2026 12:00 PM'},{desc:'Partially delivered.',created_at:'Sep 6, 2026 1:44 PM'}]);
 const expected=parser.sourceDate('2026-09-06T13:44:00+06:00');
 assert.equal(parser.parsePathaoActivity(body,partial),expected);
 assert.equal(parser.parsePathaoActivity(body,{...partial,status:'delivered'}),null);
 assert.equal(parser.parsePathaoActivity(activity('PARTIAL'),partial),null);
 await seed();
 let status='Partial Delivery', history=body;
 globalThis.__syncRead=async(_account,_provider,path)=>new Response(path.includes('archive=1')?pathao([]):pathao([row('PARTIAL','01712345678',status)]));
 globalThis.__syncActivity=async(_account,_provider,path)=>{globalThis.__activityCalls.push(path);return new Response(history);};
 await sync.startSync(owner,'pathao');await drain();
 let saved=db.prepare("SELECT status,delivered_at,delivery_checked_at FROM shipments WHERE shipment_id='PARTIAL'").get();
 assert.equal(saved.status,'partial');assert.equal(saved.delivered_at,expected);assert.ok(saved.delivery_checked_at);
 db.exec('UPDATE shipments SET delivery_checked_at=NULL,delivered_at=NULL');
 await sync.startSync(owner,'pathao');await drain();
 assert.equal(db.prepare('SELECT delivered_at FROM shipments').get().delivered_at,expected);
 await sync.startSync(owner,'pathao');await drain();assert.equal(globalThis.__activityCalls.length,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,1);
 status='Delivered';history=activity('PARTIAL');
 await sync.startSync(owner,'pathao');await drain();
 assert.equal(globalThis.__activityCalls.length,3);
 assert.equal(db.prepare('SELECT delivered_at FROM shipments').get().delivered_at,parser.sourceDate('2026-10-01T17:49:00+06:00'));
});
