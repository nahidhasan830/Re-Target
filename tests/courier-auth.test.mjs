import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
import ts from 'typescript';

const directory = await mkdtemp(join(tmpdir(), 'retarget-courier-tests-'));
for (const name of ['courier-auth', 'courier-crypto', 'courier-sessions', 'courier-validation', 'http', 'steadfast-transport']) {
  let source = await readFile(`src/lib/${name}.ts`, 'utf8');
  source = source.replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__retargetCourierTestEnv;');
  let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  compiled = compiled.replace(/from ['"]\.\/([^'"]+)['"]/g, "from './$1.mjs'").replace("from 'zod'", `from '${import.meta.resolve('zod')}'`);
  await writeFile(join(directory, `${name}.mjs`), compiled);
}
const database = new DatabaseSync(':memory:');
database.exec(await readFile('migrations/0002_user_invitations.sql', 'utf8'));
database.exec(await readFile('migrations/0004_lyrical_mathemanic.sql', 'utf8'));
database.exec(await readFile('migrations/0006_outgoing_doomsday.sql', 'utf8'));
const binding = { prepare(sql) {
  let values = [];
  return { bind(...parameters) { values = parameters; return this; },
    async first() { return database.prepare(sql).get(...values) ?? null; },
    async run() { return database.prepare(sql).run(...values); } };
} };
globalThis.__retargetCourierTestEnv = { DB: binding, COURIER_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const auth = await import(pathToFileURL(join(directory, 'courier-auth.mjs')));
const storage = await import(pathToFileURL(join(directory, 'courier-sessions.mjs')));
const encryption = await import(pathToFileURL(join(directory, 'courier-crypto.mjs')));
const transport = await import(pathToFileURL(join(directory, 'steadfast-transport.mjs')));
const nativeFetch = globalThis.fetch;
const credentials = { username: 'merchant@example.com', password: ' secret password ' };
const account = { id: 'owner-a', role: 'admin' };
const json = (data, status = 200) => Response.json(data, { status });
const token = (suffix = 'one', expires_in = 3600) => ({ access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, expires_in });
const form = '<input name="_token" value="fresh-csrf"><input name="phone">';
const cookieResponse = (body, cookies, status = 200, location) => {
  const headers = new Headers(); for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  if (location) headers.set('Location', location);
  return new Response(body, { status, headers });
};
const remember = 'remember_web_test=remember-secret; Max-Age=100000';
const sessionCookie = 'sfc_user_session=session-secret; Max-Age=7200';
beforeEach(() => { database.exec('DELETE FROM courier_credentials'); globalThis.fetch = nativeFetch; });
after(async () => { globalThis.fetch = nativeFetch; database.close(); delete globalThis.__retargetCourierTestEnv; await rm(directory, { recursive: true, force: true }); });
async function seed(provider = 'pathao', session = null, owner = account.id) {
  const encrypted = await encryption.encryptCourier(owner, provider, credentials);
  database.prepare('INSERT INTO courier_credentials (owner_id,provider,encrypted_credentials,encrypted_session,updated_at) VALUES (?,?,?,?,1)').run(owner, provider, encrypted, session ? await encryption.encryptCourier(owner, provider, session, true) : null);
}

test('Pathao signs in once then refreshes without submitting the password and retains rotation', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return json(token(calls.length)); };
  let session = await auth.renewPathao(credentials, null, fetcher);
  session = await auth.renewPathao(credentials, session, fetcher);
  session = await auth.renewPathao(credentials, session, fetcher);
  assert.deepEqual(calls[0].body, credentials);
  assert.deepEqual(calls[1].body, { grant_type: 'refresh_token', refresh_token: 'refresh-1' });
  assert.deepEqual(calls[2].body, { grant_type: 'refresh_token', refresh_token: 'refresh-2' });
  assert.equal(session.refreshToken, 'refresh-3');
  assert.ok(calls.every(call => call.url === 'https://merchant.pathao.com/api/v1/login'));
});

test('refused, malformed, blocked, and rate-limited Pathao renewal never falls back to password login', async () => {
  for (const status of [400, 401, 429, 403, 500]) {
    let calls = 0;
    await assert.rejects(auth.renewPathao(credentials, { refreshToken: 'expired' }, async () => { calls++; return json({ message: credentials.password }, status); }), error => !error.message.includes(credentials.password));
    assert.equal(calls, 1);
  }
  await assert.rejects(auth.renewPathao(credentials, null, async () => json({ access_token: 'incomplete' })), /unexpected/);
});

test('Steadfast fetches a fresh CSRF form, requests remember-me, and verifies the protected page', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return cookieResponse('<input value="csrf-login" name="_token">', ['sfc_user_session=pre-login; Max-Age=7200']);
    if (calls.length === 2) return cookieResponse('', [remember, sessionCookie], 302, 'https://steadfast.com.bd/user/profile/security/password/change');
    return cookieResponse(form, [sessionCookie]);
  };
  const session = await auth.renewSteadfast(credentials, null, fetcher);
  const posted = new URLSearchParams(calls[1].init.body);
  assert.equal(posted.get('_token'), 'csrf-login'); assert.equal(posted.get('password'), credentials.password); assert.equal(posted.get('remember'), '1');
  assert.equal(calls[2].url, 'https://steadfast.com.bd/user/frauds/create');
  assert.equal(session.cookies.remember_web_test.value, 'remember-secret');
});

test('Steadfast restores from remember-me after session expiry without a login POST', async () => {
  const cached = auth.mergeSteadfastCookies(null, [remember, sessionCookie]);
  cached.cookies.sfc_user_session.expiresAt = Date.now() - 1;
  let calls = 0;
  const restored = await auth.renewSteadfast(credentials, cached, async (_url, init) => {
    calls++; assert.equal(init.method, undefined); assert.ok(init.headers.get('Cookie').includes('remember_web_test')); assert.ok(!init.headers.get('Cookie').includes('sfc_user_session'));
    return cookieResponse(form, ['sfc_user_session=rotated; Max-Age=7200']);
  });
  assert.equal(calls, 1); assert.equal(restored.cookies.sfc_user_session.value, 'rotated');
});

test('Steadfast failed restore and expired remember-me require explicit reconnect', async () => {
  const cached = auth.mergeSteadfastCookies(null, [remember, sessionCookie]);
  let calls = 0;
  await assert.rejects(auth.renewSteadfast(credentials, cached, async () => { calls++; return cookieResponse('', [], 302, '/login'); }), /Reconnect/);
  assert.equal(calls, 1);
  cached.cookies.remember_web_test.expiresAt = Date.now() - 1;
  await assert.rejects(auth.renewSteadfast(credentials, cached, async () => { throw new Error('Must not fetch'); }), /Reconnect/);
});

test('cookie deletions, Max-Age precedence, expiry, and legacy session names are respected', () => {
  let session = auth.mergeSteadfastCookies(null, [remember, sessionCookie, 'tracking=ignored'], 1000);
  assert.equal(session.cookies.tracking, undefined);
  session = auth.mergeSteadfastCookies(session, ['sfc_user_session=deleted; Max-Age=0', 'steadfast_courier_session=new; Max-Age=10; Expires=Thu, 01 Jan 1970 00:00:00 GMT'], 1000);
  assert.equal(session.expiresAt, 11000); assert.equal(session.cookies.sfc_user_session, undefined);
  assert.equal(auth.mergeSteadfastCookies(session, [], 12000).expiresAt, 0);
});

test('persistent sessions survive repeated calls, concurrent first connects issue one login, ciphertext binds ownership', async () => {
  await seed(); let logins = 0;
  globalThis.fetch = async () => { logins++; await new Promise(resolve => setTimeout(resolve, 40)); return json(token()); };
  const sessions = await Promise.all(Array.from({ length: 3 }, () => storage.courierSession(account, 'pathao')));
  assert.equal(logins, 1); assert.ok(sessions.every(session => session.accessToken === 'access-one'));
  await storage.courierSession(account, 'pathao'); assert.equal(logins, 1);
  const row = database.prepare('SELECT * FROM courier_credentials').get();
  assert.ok(!row.encrypted_session.includes('access-one')); assert.ok(!row.encrypted_credentials.includes(credentials.password));
  await assert.rejects(encryption.decryptCourier('owner-b', 'pathao', row.encrypted_session, true));
  await assert.rejects(encryption.decryptCourier(account.id, 'steadfast', row.encrypted_session, true));
  await assert.rejects(encryption.decryptCourier(account.id, 'pathao', row.encrypted_session, false));
});

test('expiry and concurrent rejected-token renewals issue one refresh, never another password login', async () => {
  await seed('pathao', { provider: 'pathao', accessToken: 'old', refreshToken: 'refresh-old', expiresAt: Date.now() - 1 });
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.deepEqual(JSON.parse(init.body), { grant_type: 'refresh_token', refresh_token: calls === 1 ? 'refresh-old' : 'refresh-1' }); await new Promise(resolve => setTimeout(resolve, 30)); return json(token(calls)); };
  await Promise.all(Array.from({ length: 3 }, () => storage.courierSession(account, 'pathao')));
  assert.equal(calls, 1);
  const sessions = await Promise.all(Array.from({ length: 3 }, () => storage.courierSession(account, 'pathao', 'access-1')));
  assert.equal(calls, 2); assert.ok(sessions.every(session => session.accessToken === 'access-2'));
});

test('401 reads retry once using refresh and later cookies are persisted', async () => {
  await seed('pathao', { provider: 'pathao', accessToken: 'old', refreshToken: 'refresh-old', expiresAt: Date.now() + 3600000 });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/login')) return json(token('new'));
    return init.headers.get('Authorization') === 'Bearer old' ? json({}, 401) : json({ data: { merchant_id: 123 } });
  };
  assert.equal((await storage.courierRead(account, 'pathao', '/api/v1/user')).status, 200); assert.equal(calls.length, 3);
  await assert.rejects(storage.courierRead(account, 'pathao', '//evil.example/steal'), /Invalid/);
  const cached = auth.mergeSteadfastCookies(null, [remember, sessionCookie]);
  await seed('steadfast', cached);
  globalThis.fetch = async () => cookieResponse(form, ['sfc_user_session=rotated-again; Max-Age=7200']);
  await storage.courierRead(account, 'steadfast', '/user/frauds/create');
  const restored = await storage.courierSession(account, 'steadfast'); assert.equal(restored.cookies.sfc_user_session.value, 'rotated-again');
});

test('credentials changed during renewal prevent stale session writes', async () => {
  await seed();
  globalThis.fetch = async () => {
    database.prepare("UPDATE courier_credentials SET encrypted_credentials = 'replaced', encrypted_session = NULL, auth_lock = NULL WHERE owner_id = ?").run(account.id);
    return json(token());
  };
  await assert.rejects(storage.courierSession(account, 'pathao'), /credentials changed/);
  assert.equal(database.prepare('SELECT encrypted_session FROM courier_credentials').get().encrypted_session, null);
});

test('failed refresh keeps the existing pair, releases the lock, and applies a cooldown without logging in', async () => {
  await seed('pathao', { provider: 'pathao', accessToken: 'old', refreshToken: 'refresh-old', expiresAt: 0 });
  let calls = 0; globalThis.fetch = async () => { calls++; return json({ message: credentials.password }, 400); };
  await assert.rejects(storage.courierSession(account, 'pathao'), /Reconnect/);
  await assert.rejects(storage.courierSession(account, 'pathao'), /Reconnect/);
  assert.equal(calls, 1);
  const row = database.prepare('SELECT * FROM courier_credentials').get(); assert.equal(row.auth_lock, null); assert.ok(!row.auth_error.includes(credentials.password));
  const session = await encryption.decryptCourier(account.id, 'pathao', row.encrypted_session, true); assert.equal(session.refreshToken, 'refresh-old');
});

test('explicit reconnect is the only way to submit credentials again for an existing session', async () => {
  await seed('pathao', { provider: 'pathao', accessToken: 'old', refreshToken: 'revoked', expiresAt: 0 });
  globalThis.fetch = async (_url, init) => { assert.deepEqual(JSON.parse(init.body), credentials); return json(token('reconnected')); };
  const session = await storage.courierSession(account, 'pathao', '', true); assert.equal(session.accessToken, 'access-reconnected');
});

test('optional Node transport preserves cookie headers, limits destinations, and hides upstream secrets', async () => {
  const proxy = transport.steadfastTransport('https://transport.example/api/internal/steadfast-transport', 'private-token', async (url, init) => {
    assert.equal(String(url), 'https://transport.example/api/internal/steadfast-transport');
    assert.equal(init.headers.Authorization, 'Bearer private-token');
    const body = JSON.parse(init.body); assert.equal(body.url, 'https://steadfast.com.bd/login');
    return json({ status: 302, body: '', cookies: [remember, sessionCookie], location: 'https://steadfast.com.bd/user/dashboard', type: 'text/html' });
  });
  const response = await proxy('https://steadfast.com.bd/login', { method: 'POST', body: '_token=fresh&email=demo&password=private', headers: { Cookie: 'cookie-secret' } });
  assert.equal(response.status, 302); assert.equal(response.headers.getSetCookie().length, 2);
  await assert.rejects(proxy('https://evil.example/login'), /Invalid/);
  await assert.rejects(proxy('https://steadfast.com.bd/logout'), /Invalid/);
  assert.throws(() => transport.steadfastTransport('http://transport.example', 'key'), /not configured/);
  const broken = transport.steadfastTransport('https://transport.example/proxy', 'key', async () => json({ error: 'cookie-secret' }, 500));
  await assert.rejects(broken('https://steadfast.com.bd/login'), error => !error.message.includes('cookie-secret'));
});
