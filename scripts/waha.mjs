import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve4 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { root, run } from './commands.mjs';

process.chdir(root);
process.umask(0o077);
const directory = 'infra/waha';
const privateDirectory = '.waha';
const origin = 'http://127.0.0.1:3000';
const compose = (...args) => run('docker', ['compose', '-f', `${directory}/compose.yaml`, ...args]);

export async function readSettings() {
  return Object.fromEntries((await readFile(`${directory}/.env`, 'utf8')).split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
}

async function initialize() {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(`${directory}/.env`, [
      `WAHA_API_KEY=${randomBytes(32).toString('hex')}`,
      'WAHA_DASHBOARD_USERNAME=admin',
      `WAHA_DASHBOARD_PASSWORD=${randomBytes(24).toString('hex')}`, '',
    ].join('\n'), { mode: 0o600, flag: 'wx' });
    console.log(`Private credentials generated in ${directory}/.env.`);
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await chmod(`${directory}/.env`, 0o600);
  const settings = await readSettings();
  let local = '';
  try { local = await readFile('.dev.vars', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = new Set(local.split('\n').map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]));
  const missing = Object.entries({ WAHA_BASE_URL: origin, WAHA_API_KEY: settings.WAHA_API_KEY })
    .filter(([key]) => !existing.has(key));
  if (missing.length) await writeFile('.dev.vars', `${local.trimEnd()}\n${missing.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
  await chmod('.dev.vars', 0o600);
}

async function api(path, options = {}) {
  const settings = await readSettings();
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { 'X-Api-Key': settings.WAHA_API_KEY, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`WAHA ${path} returned HTTP ${response.status}.`);
  return response;
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await api('/api/sessions'); return; } catch { await delay(2000); }
  }
  throw new Error('WAHA did not become ready. Check Docker Desktop and docker compose logs locally.');
}

async function adminSession() {
  const sessions = await (await api('/api/sessions?all=true')).json();
  let session = sessions.find((entry) => entry.name === 'admin');
  if (!session) {
    session = await (await api('/api/sessions', {
      method: 'POST', body: JSON.stringify({ name: 'admin', start: true }),
    })).json();
  } else if (session.status === 'STOPPED' || session.status === 'FAILED') {
    await api(`/api/sessions/admin/${session.status === 'FAILED' ? 'restart' : 'start'}`, { method: 'POST' });
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    session = await (await api('/api/sessions/admin')).json();
    if (['SCAN_QR_CODE', 'FAILED'].includes(session.status) || (session.status === 'WORKING' && session.me?.id)) return session;
    await delay(2000);
  }
  throw new Error('Admin session is still starting. Retry npm run waha:pair.');
}

async function pair() {
  await ready();
  const session = await adminSession();
  if (session.status === 'WORKING') {
    console.log('Admin WhatsApp session is connected.');
    await rm(`${privateDirectory}/admin-qr.png`, { force: true });
    return;
  }
  if (session.status !== 'SCAN_QR_CODE') throw new Error(`Admin session status: ${session.status}.`);
  const response = await api('/api/admin/auth/qr', { headers: { Accept: 'image/png' } });
  if (!response.headers.get('content-type')?.includes('image/png')) throw new Error('WAHA did not return a PNG QR image.');
  const file = `${privateDirectory}/admin-qr.png`;
  await writeFile(file, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  console.log(`QR saved to ${file}. Scan now with WhatsApp → Linked devices → Link a device.`);
  console.log('QR codes expire quickly. Run npm run waha:pair again for a fresh image.');
}

function remoteRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      headers,
      // Fresh DNS queries avoid macOS caching a newly created hostname as absent.
      lookup(hostname, options, callback) {
        resolve4(hostname).then((addresses) => callback(null,
          options.all ? addresses.map((address) => ({ address, family: 4 })) : addresses[0], 4)).catch(callback);
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
    });
    request.on('error', reject);
    request.setTimeout(20000, () => request.destroy(new Error('WAHA tunnel request timed out.')));
    request.end();
  });
}

async function verify(remote = false) {
  const settings = await readSettings();
  let base = origin;
  const headers = { 'X-Api-Key': settings.WAHA_API_KEY };
  if (remote) {
    const secrets = JSON.parse(await readFile(`${privateDirectory}/worker-secrets.json`, 'utf8'));
    base = secrets.WAHA_BASE_URL;
    headers['CF-Access-Client-Id'] = secrets.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = secrets.CF_ACCESS_CLIENT_SECRET;
  }
  const request = (h) => remote ? remoteRequest(`${base}/api/sessions?all=true`, h)
    : fetch(`${base}/api/sessions?all=true`, { headers: h, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const unauthorized = await request({});
  if (remote ? ![302, 401, 403].includes(unauthorized.status) : unauthorized.status !== 401) {
    throw new Error(`Unauthenticated request returned unexpected HTTP ${unauthorized.status}.`);
  }
  if (remote) {
    const withoutKey = { ...headers }; delete withoutKey['X-Api-Key'];
    const response = await request(withoutKey);
    if (response.status !== 401) throw new Error(`Access token without WAHA key returned HTTP ${response.status}.`);
    const withoutAccess = await request({ 'X-Api-Key': headers['X-Api-Key'] });
    if (![302, 401, 403].includes(withoutAccess.status)) throw new Error('Cloudflare Access did not reject a request without its token.');
  }
  const authorized = await request(headers);
  if (!authorized.ok) throw new Error(`Authenticated request returned HTTP ${authorized.status}.`);
  const sessions = await authorized.json();
  console.log(`${remote ? 'Tunnel' : 'Local'} authentication verified. Sessions: ${sessions.map((s) => `${s.name}:${s.status}`).join(', ') || 'none'}.`);
}

async function backup() {
  await ready();
  await mkdir('backups/waha', { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = `waha-${timestamp}.tar.gz`;
  // Stop writes while copying SQLite and browser authentication files.
  await compose('stop', 'waha');
  try {
    await run('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'tar',
      '-v', 're-target-waha-sessions:/sessions:ro', '-v', `${root}backups/waha:/backup`,
      'devlikeapro/waha:arm@sha256:b4216daddb7d5c1eb3ab99e608b76a005ec7523e766f923939d229718df4aafb',
      '-czf', `/backup/${archive}`, '-C', '/sessions', '.']);
    await chmod(`backups/waha/${archive}`, 0o600);
    console.log(`Private session backup: backups/waha/${archive}`);
  } finally { await compose('start', 'waha'); }
  await ready();
}

async function awake(start) {
  const file = `${privateDirectory}/awake.pid`;
  let pid;
  try { pid = Number(await readFile(file, 'utf8')); } catch {}
  if (pid) {
    try {
      const command = await run('ps', ['-p', String(pid), '-o', 'comm='], { capture: true });
      if (command.includes('caffeinate')) {
        if (start) return;
        process.kill(pid, 'SIGTERM');
      }
    } catch {}
    await rm(file, { force: true });
  }
  if (start && process.platform === 'darwin') {
    const child = spawn('/usr/bin/caffeinate', ['-i'], { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    await writeFile(file, String(child.pid), { mode: 0o600 });
    console.log('Idle sleep prevented until npm run waha:stop. Keep the lid open and connect power.');
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'init') return initialize();
  if (command === 'start') {
    await initialize();
    try { await run('docker', ['info'], { capture: true }); }
    catch {
      if (process.platform !== 'darwin') throw new Error('Start Docker before starting WAHA.');
      await run('open', ['-a', 'Docker']);
      let running = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        try { await run('docker', ['info'], { capture: true }); running = true; break; } catch { await delay(2000); }
      }
      if (!running) throw new Error('Docker Desktop did not start.');
    }
    await compose('up', '-d', '--wait', '--wait-timeout', '180', 'waha');
    await awake(true);
    let tunnelReady = false;
    try { tunnelReady = JSON.parse(await readFile(`${privateDirectory}/cloudflare.json`, 'utf8')).dnsReady; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (tunnelReady) await run(process.execPath, ['scripts/waha-cloudflare.mjs', 'start']);
    console.log(`WAHA dashboard: ${origin}/dashboard`);
  } else if (command === 'stop') {
    await run(process.execPath, ['scripts/waha-cloudflare.mjs', 'stop']);
    await compose('stop');
    await awake(false);
  } else if (command === 'status') {
    await compose('ps');
    await verify();
  } else if (command === 'pair') await pair();
  else if (command === 'verify') await verify(process.argv.includes('--remote'));
  else if (command === 'backup') await backup();
  else throw new Error('Use init, start, stop, status, pair, verify [--remote], or backup.');
}

if (process.argv[1]?.endsWith('/waha.mjs')) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
