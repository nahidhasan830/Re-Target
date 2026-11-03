import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { fakeWaha } from './helpers/waha.mjs';
import { passwordHash } from '../scripts/password-hash.mjs';

const dir = await mkdtemp(join(tmpdir(), 'retarget-reset-tests-')), db = new DatabaseSync(':memory:');
for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) db.exec(await readFile(`migrations/${file}`, 'utf8'));
const gateway = await fakeWaha('reset-fixture-key');
let now = Date.parse('2026-11-03T11:00:00+06:00') / 1000;
const realNow = Date.now;
Date.now = () => now * 1000;
const binding = {
  prepare(sql) {
    let values = [];
    const statement = () => db.prepare(sql.replaceAll('unixepoch()', String(now)));
    return {
      bind(...args) { values = args; return this; },
      async first(column) { const result = statement().get(...values); return column ? (result?.[column] ?? null) : (result ?? null); },
      execute() { const result = statement().run(...values); return { results: [], meta: { changes: Number(result.changes) } }; },
      async all() { return { results: statement().all(...values), meta: {} }; },
      async run() { return this.execute(); },
    };
  },
  async batch(statements) {
    db.exec('BEGIN');
    try { const results = statements.map((s) => s.execute()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};
globalThis.__resetEnv = {
  DB: binding, WAHA_BASE_URL: gateway.url, WAHA_API_KEY: 'reset-fixture-key', ADMIN_PHONE: '01700000000',
  ADMIN_PASSWORD_HASH: passwordHash('configured admin password'), CAMPAIGN_QUEUE: { async send() {} }, LEAD_SYNC: { async send() {} },
};
await build({
  stdin: {
    contents: "export * from './src/lib/password-resets'; export * from './src/lib/auth'; export { recoverCampaigns } from './src/lib/campaign-delivery'; export { reviewSender, senderReviewState } from './src/lib/campaign-sender'; export { reserveAdminSender } from './src/lib/sender-reservation';",
    resolveDir: process.cwd(), sourcefile: 'reset-test-entry.ts',
  },
  outfile: join(dir, 'resets.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'test-env', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const env=globalThis.__resetEnv;' }));
    builder.onResolve({ filter: /^(zod|drizzle-orm|htmlparser2|domutils|domhandler)/ }, (args) => ({ path: import.meta.resolve(args.path).replace('file://', ''), external: true }));
  } }],
});
const r = await import(pathToFileURL(join(dir, 'resets.mjs')));
const one = (sql, ...args) => db.prepare(sql).get(...args), run = (sql, ...args) => db.prepare(sql).run(...args);
const origin = 'https://retarget.example';
const admin = { id: 'admin', role: 'admin', phone: '01700000000', companyName: 'Re-Target', credentialVersion: 'test' };
async function configure(extra = {}) {
  await fetch(`${gateway.url}/__test/state`, { method: 'POST', headers: { 'X-Api-Key': 'reset-fixture-key' },
    body: JSON.stringify({ session: { status: 'WORKING', me: { id: '8801700000000@c.us' } }, ...extra }) });
}
const outgoing = async () => (await fetch(`${gateway.url}/__test/messages`, { headers: { 'X-Api-Key': 'reset-fixture-key' } })).json();
const linkToken = (message) => message.text.match(/\/reset-password\/([a-f0-9]{64})/)?.[1];
const sessionFor = (token) => ({ get: () => ({ value: token }) });
function user(phone = '01711111111', password = 'old business password') {
  run('INSERT INTO users(id,phone,company_name,password_hash,created_at) VALUES (?,?,?,?,?)', randomUUID(), phone, 'Fixture business', passwordHash(password), now);
  return phone;
}
beforeEach(async () => {
  db.exec('DELETE FROM password_resets; DELETE FROM campaign_send_attempts; DELETE FROM campaign_actions; DELETE FROM sender_dispatch_state; DELETE FROM user_sessions; DELETE FROM whatsapp_connections; DELETE FROM users; DELETE FROM admin_accounts;');
  now = Date.parse('2026-11-03T11:00:00+06:00') / 1000;
  await configure();
  run("INSERT INTO whatsapp_connections(owner_id,session_name,phone,status,checked_at) VALUES ('admin','admin','01700000000','WORKING',?)", now);
});
after(async () => {
  Date.now = realNow;
  db.close();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
  delete globalThis.__resetEnv;
});

test('reset links reach only active accounts and store just the token digest', async () => {
  await r.requestPasswordReset('01799999999', origin);
  run('INSERT INTO users(id,phone,company_name,password_hash,active,created_at) VALUES (?,?,?,?,0,?)', randomUUID(), '01722222222', 'Inactive', passwordHash('x'.repeat(12)), now);
  await r.requestPasswordReset('01722222222', origin);
  assert.equal((await outgoing()).length, 0);
  assert.equal(one('SELECT COUNT(*) n FROM password_resets').n, 0);
  await r.requestPasswordReset(user(), origin);
  const [message] = await outgoing();
  assert.equal(message.chatId, '8801711111111@c.us');
  assert.ok(message.text.startsWith(`Reset your Re-Target password:\n${origin}/reset-password/`));
  const row = one('SELECT * FROM password_resets');
  assert.equal(row.token_hash, createHash('sha256').update(linkToken(message)).digest('hex'));
  assert.equal(row.delivery_status, 'sent');
  assert.equal(row.expires_at, now + 30 * 60);
  assert.equal(one('SELECT status FROM campaign_send_attempts WHERE password_reset_id=?', row.id).status, 'accepted');
  assert.equal(one('SELECT active_attempt FROM sender_dispatch_state').active_attempt, null);
  assert.equal((await r.passwordResetForToken(linkToken(message))).state, 'valid');
});

test('repeat requests wait five minutes and a newer link replaces the older one', async () => {
  const phone = user();
  await r.requestPasswordReset(phone, origin);
  now += 299;
  await r.requestPasswordReset(phone, origin);
  assert.equal((await outgoing()).length, 1);
  now += 1;
  await r.requestPasswordReset(phone, origin);
  const [first, second] = await outgoing();
  assert.ok(second);
  assert.equal(await r.passwordResetForToken(linkToken(first)), null);
  assert.equal((await r.passwordResetForToken(linkToken(second))).state, 'valid');
});

test('a link changes the password once and signs out existing sessions', async () => {
  const phone = user();
  const account = await r.authenticate(phone, 'old business password');
  const cookie = 'c'.repeat(64);
  run('INSERT INTO user_sessions(token_hash,user_id,credential_version,expires_at) VALUES (?,?,?,?)', createHash('sha256').update(cookie).digest('hex'), account.id, account.credentialVersion, now + 3600);
  assert.ok(await r.currentAccount(sessionFor(cookie)));
  await r.requestPasswordReset(phone, origin);
  const token = linkToken((await outgoing())[0]);
  assert.equal(await r.resetPassword(token, 'brand new password'), phone);
  assert.equal(await r.authenticate(phone, 'old business password'), null);
  assert.equal((await r.authenticate(phone, 'brand new password')).credentialVersion, 2);
  assert.equal(await r.currentAccount(sessionFor(cookie)), null);
  assert.equal((await r.passwordResetForToken(token)).state, 'used');
  await assert.rejects(r.resetPassword(token, 'another new password'), /no longer valid/);
  assert.ok(await r.authenticate(phone, 'brand new password'));
});

test('expired links and links issued before a password change are rejected', async () => {
  const phone = user();
  await r.requestPasswordReset(phone, origin);
  const token = linkToken((await outgoing())[0]);
  now += 30 * 60;
  assert.equal((await r.passwordResetForToken(token)).state, 'expired');
  await assert.rejects(r.resetPassword(token, 'brand new password'), /no longer valid/);
  now += 5 * 60;
  await r.requestPasswordReset(phone, origin);
  const fresh = linkToken((await outgoing())[1]);
  run('UPDATE users SET credential_version=credential_version+1 WHERE phone=?', phone);
  assert.equal((await r.passwordResetForToken(fresh)).state, 'expired');
  await assert.rejects(r.resetPassword(fresh, 'brand new password'), /no longer valid/);
  assert.ok(await r.authenticate(phone, 'old business password'));
});

test('the admin can recover through WhatsApp and the configured password stops working', async () => {
  await r.requestPasswordReset('01700000000', origin);
  const [message] = await outgoing();
  assert.equal(message.chatId, '8801700000000@c.us');
  await r.resetPassword(linkToken(message), 'recovered admin password');
  assert.equal(await r.authenticate('01700000000', 'configured admin password'), null);
  assert.equal((await r.authenticate('01700000000', 'recovered admin password')).role, 'admin');
  assert.equal((await r.passwordResetForToken(linkToken(message))).state, 'used');
});

test('an undelivered link expires and lifts the cooldown', async () => {
  const phone = user();
  await configure({ sendStatus: 400 });
  await r.requestPasswordReset(phone, origin);
  const row = one('SELECT delivery_status,expires_at,sent_at FROM password_resets');
  assert.deepEqual({ ...row }, { delivery_status: 'failed', expires_at: 0, sent_at: 0 });
  assert.equal(one('SELECT active_attempt FROM sender_dispatch_state').active_attempt, null);
  await configure();
  await r.requestPasswordReset(phone, origin);
  assert.equal((await outgoing()).length, 1);
  assert.equal(one('SELECT delivery_status FROM password_resets').delivery_status, 'sent');
});

test('a paused sender sends nothing and leaves no usable link', async () => {
  const phone = user();
  run("INSERT INTO sender_dispatch_state(owner_id,session_name,phone,pause_reason) VALUES ('admin','admin','01700000000','Fixture pause')");
  await assert.rejects(r.requestPasswordReset(phone, origin), /paused/);
  assert.equal((await outgoing()).length, 0);
  assert.deepEqual({ ...one('SELECT delivery_status,expires_at FROM password_resets') }, { delivery_status: 'failed', expires_at: 0 });
});

test('unconfirmed reset sends hold the sender for review, like invitations', async () => {
  const phone = user();
  await configure({ sendStatus: 503 });
  await r.requestPasswordReset(phone, origin);
  assert.equal(one('SELECT delivery_status FROM password_resets').delivery_status, 'unknown');
  assert.match(one('SELECT pause_reason FROM sender_dispatch_state').pause_reason, /Password reset send unconfirmed/);
  assert.equal(one('SELECT status FROM campaign_send_attempts').status, 'unconfirmed');
  assert.equal((await r.senderReviewState(admin)).attempt.recipient, phone);
  await configure();
  await r.reviewSender(admin, { requestId: randomUUID(), evidence: 'Checked WhatsApp; nothing was sent.', invitationOutcome: 'failed' });
  assert.equal(one('SELECT delivery_status FROM password_resets').delivery_status, 'failed');
  assert.deepEqual({ ...one('SELECT active_attempt,pause_reason FROM sender_dispatch_state') }, { active_attempt: null, pause_reason: null });
});

test('a disconnect pause resumes only while WhatsApp is connected', async () => {
  const reason = 'WhatsApp disconnected. Reconnect it, then resume sending.';
  run("INSERT INTO sender_dispatch_state(owner_id,session_name,phone,pause_reason) VALUES ('admin','admin','01700000000',?)", reason);
  assert.equal((await r.senderReviewState(admin)).sender.pauseReason, reason);
  await configure({ session: { status: 'STOPPED', me: null } });
  await assert.rejects(r.reviewSender(admin, { requestId: randomUUID(), evidence: 'Resumed from the WhatsApp page.' }), /Connect WhatsApp/);
  assert.equal(one('SELECT pause_reason FROM sender_dispatch_state').pause_reason, reason);
  await configure();
  await r.reviewSender(admin, { requestId: randomUUID(), evidence: 'Resumed from the WhatsApp page.' });
  assert.equal(one('SELECT pause_reason FROM sender_dispatch_state').pause_reason, null);
  assert.equal(one("SELECT action FROM campaign_actions WHERE owner_id='admin'").action, 'sender_review');
  await r.requestPasswordReset(user(), origin);
  assert.equal((await outgoing()).length, 1);
});

test('recovery pauses the sender when a reset send never recorded an outcome', async () => {
  const phone = user();
  run("INSERT INTO password_resets(id,phone,token_hash,credential_version,expires_at,delivery_status,sent_at) VALUES ('stuck',?,?,'1',?,'sending',?)", phone, 'a'.repeat(64), now + 1800, now);
  await r.reserveAdminSender('stuck', '01700000000', 'password_reset');
  now += 61;
  await r.recoverCampaigns();
  assert.equal(one('SELECT status FROM campaign_send_attempts').status, 'unconfirmed');
  assert.equal(one('SELECT delivery_status FROM password_resets').delivery_status, 'unknown');
  assert.match(one('SELECT pause_reason FROM sender_dispatch_state').pause_reason, /Password reset send unconfirmed/);
});
