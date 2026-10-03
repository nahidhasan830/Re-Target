import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { constants, createDecipheriv, generateKeyPairSync, pbkdf2Sync, privateDecrypt } from 'node:crypto';
import CachePolicy from 'http-cache-semantics';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { passwordHash } from '../scripts/password-hash.mjs';
import { encryptBackup, backupPublicKey } from '../scripts/encrypt-backup.mjs';
import { decryptBackup } from '../scripts/decrypt-backup.mjs';

const dir = await mkdtemp(join(tmpdir(), 'retarget-security-'));
const db = new DatabaseSync(':memory:');
for (const file of (await readdir('migrations')).filter(f => f.endsWith('.sql')).sort()) db.exec(await readFile(`migrations/${file}`, 'utf8'));
const binding = { prepare(sql) {
  let args = [];
  return {
    bind(...values) { args = values; return this; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
  };
} };
const legacy = `pbkdf2-sha256:100000:${'ab'.repeat(16)}:${pbkdf2Sync('legacy password', Buffer.from('ab'.repeat(16), 'hex'), 100000, 32, 'sha256').toString('hex')}`;
globalThis.__securityEnv = { DB: binding, ADMIN_PHONE: '01700000000', ADMIN_PASSWORD_HASH: passwordHash('admin password'), ADMIN_API_TOKEN: 'fixture-admin-token-at-least-32-characters', WAHA_BASE_URL: 'https://gateway.example', WAHA_API_KEY: 'fixture-gateway-key' };
const envPlugin = { name: 'mock-platform', setup(b) {
  b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'mock' }));
  b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const env=globalThis.__securityEnv;' }));
  b.onResolve({ filter: /^astro:middleware$/ }, () => ({ path: 'middleware', namespace: 'astro-mock' }));
  b.onLoad({ filter: /.*/, namespace: 'astro-mock' }, () => ({ contents: 'export const defineMiddleware=handler=>handler;' }));
} };
for (const [name, file] of Object.entries({ auth: 'src/lib/auth.ts', password: 'src/lib/password.ts', middleware: 'src/middleware.ts', waha: 'src/lib/waha.ts' })) {
  await build({ entryPoints: [file], outfile: join(dir, `${name}.mjs`), bundle: true, platform: 'node', format: 'esm', plugins: [envPlugin] });
}
const auth = await import(pathToFileURL(join(dir, 'auth.mjs')));
const password = await import(pathToFileURL(join(dir, 'password.mjs')));
const { onRequest } = await import(pathToFileURL(join(dir, 'middleware.mjs')));
const waha = await import(pathToFileURL(join(dir, 'waha.mjs')));
beforeEach(() => { db.exec('DELETE FROM users; DELETE FROM admin_accounts; DELETE FROM login_attempts;'); });
after(async () => { db.close(); delete globalThis.__securityEnv; await rm(dir, { recursive: true, force: true }); });

test('new verifiers use scrypt and reject wrong passwords and malformed hashes', async () => {
  const hash = await password.hashPassword(' new password ');
  assert.match(hash, /^scrypt:16384:8:5:/);
  assert.equal(await password.verifyPassword(' new password ', hash), true);
  assert.equal(await password.verifyPassword('new password', hash), false);
  assert.equal(await password.verifyPassword('admin password', globalThis.__securityEnv.ADMIN_PASSWORD_HASH), true);
  for (const hash of ['broken', legacy.replace('100000', '1'), legacy.replace('100000', '999999999'), legacy + ':extra', 'scrypt:2:8:1:a:b']) assert.equal(await password.verifyPassword('legacy password', hash), false);
  assert.equal(await password.verifyPassword('legacy password', legacy), true);
});

test('password hashing runs in workerd without application bindings or persistent data', async () => {
  const source = await readFile(join(dir, 'password.mjs'), 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    script: source + "\nexport default {async fetch(){ const h=await hashPassword('synthetic password'); return Response.json({valid:await verifyPassword('synthetic password',h),wrong:await verifyPassword('wrong',h)}); }};" }));
  try {
    const response = await mf.dispatchFetch('http://localhost');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { valid: true, wrong: false });
  } finally { await mf.dispose(); }
});

test('successful legacy user login upgrades the verifier and invalidates the old credential version', async () => {
  db.prepare('INSERT INTO users(id,phone,company_name,password_hash,created_at) VALUES (?,?,?,?,1)').run('owner-a', '01700000001', 'Fixture', legacy);
  assert.equal(await auth.authenticate('01700000001', 'wrong'), null);
  assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash, legacy);
  const account = await auth.authenticate('01700000001', 'legacy password');
  const row = db.prepare('SELECT password_hash,credential_version FROM users').get();
  assert.match(row.password_hash, /^scrypt:/);
  assert.equal(account.credentialVersion, row.credential_version);
  assert.equal(row.credential_version, 2);
  assert.equal((await auth.authenticate('01700000001', 'legacy password')).credentialVersion, 2);
});

test('legacy admin upgrade preserves configured recovery credentials and detects later rotation', async () => {
  const env = globalThis.__securityEnv, original = env.ADMIN_PASSWORD_HASH;
  env.ADMIN_PASSWORD_HASH = legacy;
  try {
    const account = await auth.authenticate(env.ADMIN_PHONE, 'legacy password');
    const saved = await auth.adminCredentials();
    assert.match(saved.hash, /^scrypt:/);
    assert.equal(account.credentialVersion, await auth.digest(saved.hash));
    assert.equal(saved.sourceHash, legacy);
    env.ADMIN_PASSWORD_HASH = original;
    assert.equal((await auth.adminCredentials()).hash, original);
  } finally { env.ADMIN_PASSWORD_HASH = original; }
});

test('login limits stop attempts atomically and reject cross-origin requests', async () => {
  const request = new Request('https://app.example/', { headers: { 'CF-Connecting-IP': '192.0.2.1', Origin: 'https://app.example' } });
  await Promise.all(Array.from({ length: 10 }, () => auth.limitLogin(request)));
  await assert.rejects(auth.limitLogin(request), e => e.status === 429);
  auth.requireSameOrigin(request);
  assert.throws(() => auth.requireSameOrigin(new Request(request.url, { headers: { Origin: 'https://attacker.example' } })), e => e.status === 403);
});

test('admin API protection covers encoded paths and sets browser protections on errors', async () => {
  for (const path of ['/api/products', '/api/%70roducts', '/%61pi/products/fixture']) {
    const url = new URL(path, 'https://app.example');
    let reached = false;
    const response = await onRequest({ url, request: new Request(url) }, async () => { reached = true; return new Response('private'); });
    assert.equal(response.status, 401);
    assert.equal(reached, false);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
    assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  }
});

test('gateway rejects insecure hosts, userinfo and destination switching before sending credentials', async () => {
  const env = globalThis.__securityEnv, base = env.WAHA_BASE_URL;
  for (const url of ['http://gateway.example', 'https://user:password@gateway.example']) {
    env.WAHA_BASE_URL = url;
    await assert.rejects(waha.gatewayRequest('/api/sessions'), e => e.status === 503);
  }
  env.WAHA_BASE_URL = base;
  await assert.rejects(waha.gatewayRequest('//attacker.example/steal'), e => e.status === 503);
  await assert.rejects(waha.gatewayJson(new Response('x'.repeat(1024 * 1024 + 1))), e => e.status === 503);
});

test('max-stale cannot expose security-zeroed cookies or non-cacheable responses', () => {
  const request = { url: 'https://app.example/private', method: 'GET', headers: {} };
  for (const headers of [{ 'set-cookie': 'session=fixture' }, { 'cache-control': 'private' }, { 'cache-control': 'no-store' }, { 'cache-control': 'no-cache' }, { 'cache-control': 'max-age=0' }]) {
    const policy = new CachePolicy(request, { status: 200, headers });
    for (const directive of ['max-stale', 'max-stale=999999999']) {
      const result = policy.evaluateRequest({ ...request, headers: { 'cache-control': directive } });
      assert.equal(result.response, undefined);
      assert.equal(result.revalidation.synchronous, true);
    }
  }
  const publicPolicy = new CachePolicy(request, { status: 200, headers: { 'cache-control': 'public, max-age=3600' } });
  assert.equal(publicPolicy.satisfiesWithoutRevalidation(request), true);
});

test('CI backup envelope decrypts only with the private key and authenticates its contents', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const source = Buffer.from('synthetic private account data');
  const envelope = JSON.parse(encryptBackup(source, publicKey.export({ type: 'spki', format: 'pem' })));
  assert.ok(!JSON.stringify(envelope).includes(source.toString()));
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64'));
  const decrypt = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decrypt.setAAD(Buffer.from('retarget-backup-v1'));
  decrypt.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  assert.deepEqual(Buffer.concat([decrypt.update(Buffer.from(envelope.data, 'base64')), decrypt.final()]), source);
  assert.deepEqual(decryptBackup(envelope, privateKey), source);
  const tampered = Buffer.from(envelope.data, 'base64');
  tampered[0] ^= 1;
  assert.throws(() => decryptBackup({ ...envelope, data: tampered.toString('base64') }, privateKey));
  assert.throws(() => backupPublicKey(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' })), /RSA/);
});
