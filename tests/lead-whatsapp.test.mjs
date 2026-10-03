import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';
import ts from 'typescript';
import { fakeWaha } from './helpers/waha.mjs';
const gateway = await fakeWaha('synthetic-check-key');
const dir = await mkdtemp(join(tmpdir(), 'retarget-whatsapp-check-'));
let source = (await readFile('src/lib/lead-whatsapp.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__checkEnv;');
let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
compiled = compiled.replace("from './waha'", "from './waha.mjs'").replace("from 'zod'", `from '${import.meta.resolve('zod')}'`);
await writeFile(join(dir, 'lead-whatsapp.mjs'), compiled);
await writeFile(join(dir, 'waha.mjs'), 'export const whatsAppState = name => globalThis.__checkState(name); export const checkWhatsAppNumber = (...args) => globalThis.__checkNumber(...args);');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) db.exec(await readFile(`migrations/${file}`, 'utf8'));
const binding = { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { return db.prepare(sql).run(...args); } }; } };
let jobs, calls, state;
globalThis.__checkEnv = { WAHA_BASE_URL: gateway.url, WAHA_API_KEY: 'synthetic-check-key', DB: binding, LEAD_SYNC: { async send(message) { jobs.push(message); } } };
const checks = await import(pathToFileURL(join(dir, 'lead-whatsapp.mjs')));
const business = '5e1f9b3f-56e7-4cbd-8188-df7dd23fe21b';
beforeEach(() => {
  db.exec('DELETE FROM shipments; DELETE FROM leads; DELETE FROM users;');
  jobs = []; calls = []; state = 'WORKING';
  globalThis.__checkState = async session => { calls.push({ session }); return { status: state }; };
  globalThis.__checkNumber = async (session, phone) => { calls.push({ session, phone }); return { exists: phone.endsWith('8'), chatId: phone.endsWith('8') ? `${phone}@c.us` : null }; };
});
after(async () => { await gateway.close(); db.close(); await rm(dir, { recursive: true, force: true }); delete globalThis.__checkEnv; delete globalThis.__checkState; delete globalThis.__checkNumber; });
function lead(id, phone = '8801712345678', owner = 'admin', status = 'delivered') {
  db.prepare('INSERT INTO leads(id,owner_id,user_id,phone,name,created_at) VALUES (?,?,?,?,?,1)').run(id, owner, owner === 'admin' ? null : owner, phone, 'Test');
  db.prepare("INSERT INTO shipments(id,owner_id,lead_id,provider,shipment_id,raw_status,status) VALUES (?,?,?,'pathao',?,'Delivered',?)").run(`s-${id}`, owner, id, id, status);
}
test('automatic jobs verify each qualifying number, persist negative results and remain idempotent', async () => {
  lead('a'); lead('b', '8801812345679'); lead('pending', '8801912345678', 'admin', 'pending');
  await checks.enqueueWhatsAppChecks('admin'); assert.deepEqual(jobs, [{ kind: 'whatsapp', ownerId: 'admin' }]);
  await checks.processWhatsAppChecks('admin');
  assert.equal(db.prepare("SELECT whatsapp_exists FROM leads WHERE id='a'").get().whatsapp_exists, 1);
  assert.equal(db.prepare("SELECT whatsapp_exists FROM leads WHERE id='b'").get().whatsapp_exists, 0);
  assert.equal(db.prepare("SELECT whatsapp_exists FROM leads WHERE id='pending'").get().whatsapp_exists, null);
  const before = calls.length; await checks.processWhatsAppChecks('admin'); assert.equal(calls.length, before);
});
test('disconnected and failed checks stay unknown and are recovered after connection or a later sync', async () => {
  lead('a'); state = 'STOPPED'; await checks.processWhatsAppChecks('admin');
  assert.equal(db.prepare('SELECT whatsapp_exists FROM leads').get().whatsapp_exists, null);
  state = 'WORKING'; globalThis.__checkNumber = async () => { throw new Error('Private upstream details'); };
  await checks.processWhatsAppChecks('admin');
  assert.equal(db.prepare('SELECT whatsapp_exists FROM leads').get().whatsapp_exists, null);
  assert.ok(db.prepare('SELECT whatsapp_check_until FROM leads').get().whatsapp_check_until > Date.now() / 1000);
  db.exec('UPDATE leads SET whatsapp_check_until = 0'); await checks.recoverWhatsAppChecks(); assert.equal(jobs.length, 1);
  globalThis.__checkNumber = async () => ({ exists: true, chatId: '8801712345678@c.us' });
  await checks.processWhatsAppChecks('admin'); assert.equal(db.prepare('SELECT whatsapp_exists FROM leads').get().whatsapp_exists, 1);
});
test('checks use the owner session and never process another account or inactive users', async () => {
  db.prepare("INSERT INTO users(id,phone,company_name,password_hash,created_at) VALUES (?,'01800000000','Test','hash',1)").run(business);
  lead('admin'); lead('business', '8801712345678', business);
  await checks.processWhatsAppChecks(business);
  assert.ok(calls.every(call => call.session === `business_${business.replaceAll('-', '')}`));
  assert.equal(db.prepare("SELECT whatsapp_exists FROM leads WHERE id='admin'").get().whatsapp_exists, null);
  db.exec('UPDATE users SET active=0; UPDATE leads SET whatsapp_exists=NULL'); calls = [];
  await checks.processWhatsAppChecks(business); assert.equal(calls.length, 0);
});
test('bounded batches continue to the remaining leads and recover expired leases', async () => {
  for (let i = 0; i < 12; i++) lead(String(i), `88017${String(i).padStart(8, '0')}`);
  db.exec("UPDATE leads SET whatsapp_check_until = unixepoch()+120 WHERE id='0'");
  await checks.processWhatsAppChecks('admin');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM leads WHERE whatsapp_exists IS NOT NULL').get().n, 5);
  assert.equal(jobs.length, 1);
  await checks.processWhatsAppChecks('admin'); await checks.processWhatsAppChecks('admin');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM leads WHERE whatsapp_exists IS NOT NULL').get().n, 11);
  db.exec("UPDATE leads SET whatsapp_check_until = unixepoch()-1 WHERE id='0'");
  await checks.recoverWhatsAppChecks(); await checks.processWhatsAppChecks('admin');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM leads WHERE whatsapp_exists IS NOT NULL').get().n, 12);
});

test('gateway checks validate responses and preserve the owner session and international phone', async () => {
  let wireSource = (await readFile('src/lib/waha.ts', 'utf8')).replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__checkEnv;');
  let wireCompiled = ts.transpileModule(wireSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from ['"]\.\/([^'"]+)['"]/g, "from './$1.mjs'");
  await writeFile(join(dir, 'waha-wire.mjs'), wireCompiled);
  const restrictions = await readFile('src/lib/whatsapp-restrictions.ts', 'utf8');
  await writeFile(join(dir, 'whatsapp-restrictions.mjs'), ts.transpileModule(restrictions, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const httpSource = await readFile('src/lib/http.ts', 'utf8');
  await writeFile(join(dir, 'http.mjs'), ts.transpileModule(httpSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("from 'zod'", `from '${import.meta.resolve('zod')}'`));
  const wire = await import(pathToFileURL(join(dir, 'waha-wire.mjs')));
  const set = data => fetch(`${gateway.url}/__test/state`, { method: 'POST', headers: { 'X-Api-Key': 'synthetic-check-key' }, body: JSON.stringify(data) });
  const sessions = { business_test: { status: 'WORKING' } };
  await set({ sessions });
  assert.deepEqual(await wire.checkWhatsAppNumber('business_test', '8801712345678'), { exists: true, chatId: '8801712345678@c.us' });
  assert.deepEqual(await wire.checkWhatsAppNumber('business_test', '8801812345679'), { exists: false, chatId: null });
  await set({ sessions, numberCheckResponse: { numberExists: 'false' } });
  await assert.rejects(wire.checkWhatsAppNumber('business_test', '8801712345678'), /unexpected account check/);
  await set({ sessions, numberCheckResponse: { numberExists: true, chatId: 'untrusted' } });
  await assert.rejects(wire.checkWhatsAppNumber('business_test', '8801712345678'), /unexpected account check/);
  await set({ sessions, failure: true });
  await assert.rejects(wire.checkWhatsAppNumber('business_test', '8801712345678'), /Could not check/);
});
