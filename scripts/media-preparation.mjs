import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { root, run } from './commands.mjs';
import { cloudflareApi as api } from './cloudflare-api.mjs';

process.chdir(root);
process.umask(0o077);
const directory = 'infra/media-preparation';
const hostname = 'media.nahidlabs.com';
const origin = `https://${hostname}`;
const stateFile = '.waha/media.json';
const compose = (...args) => run('docker', ['compose', '--env-file', `${directory}/.env`, '-f', `${directory}/compose.yml`, ...args]);
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const prefix = `/accounts/${config.account_id}`;
const gateway = JSON.parse(await readFile('.waha/cloudflare.json', 'utf8'));
const secrets = JSON.parse(await readFile('.deploy/production-secrets.json', 'utf8'));
const key = secrets.MEDIA_PREPARATION_KEY;
if (!key || key.length < 32) throw new Error('The saved preparation key is missing.');

async function initialize() {
  await writeFile(`${directory}/.env`, `MEDIA_PREPARATION_KEY=${key}\n`, { mode: 0o600 });
  await chmod(`${directory}/.env`, 0o600);
}

async function setup() {
  await initialize();
  let state = {};
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const apps = await api(`${prefix}/access/apps?per_page=100`);
  const matches = apps.filter((app) => app.domain === hostname);
  if (matches.some((app) => app.id !== state.appId)) throw new Error('Media hostname already has an Access application outside this setup.');
  const tokens = await api(`${prefix}/access/service_tokens?per_page=100`);
  if (!tokens.some((token) => token.id === gateway.serviceTokenId)) throw new Error('The existing backend service token is unavailable.');
  const zones = await api('/zones?name=nahidlabs.com');
  if (zones.length !== 1) throw new Error('Expected one nahidlabs.com zone.');
  const dnsPath = `/zones/${zones[0].id}/dns_records`;
  const records = await api(`${dnsPath}?name=${hostname}`);
  const target = `${gateway.tunnelId}.cfargotunnel.com`;
  if (records.length && (records.length !== 1 || records[0].type !== 'CNAME' || records[0].content !== target || !records[0].proxied)) throw new Error('Media hostname has a conflicting DNS record.');
  if (!state.appId) {
    const app = await api(`${prefix}/access/apps`, 'POST', {
      name: 'Re-Target media preparation', type: 'self_hosted', domain: hostname,
      app_launcher_visible: false,
      policies: [{ name: 'Re-Target backend only', decision: 'non_identity',
        include: [{ service_token: { token_id: gateway.serviceTokenId } }], exclude: [], require: [] }],
    });
    state.appId = app.id;
    await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  const policies = await api(`${prefix}/access/apps/${state.appId}/policies`);
  if (policies.length !== 1 || policies[0].decision !== 'non_identity' || policies[0].include?.length !== 1 || policies[0].include[0].service_token?.token_id !== gateway.serviceTokenId || policies[0].exclude?.length || policies[0].require?.length) throw new Error('Media Access policy must accept only the existing backend token.');
  const tunnel = await api(`${prefix}/cfd_tunnel/${gateway.tunnelId}`);
  if (tunnel.name !== 're-target-waha' || tunnel.config_src !== 'cloudflare') throw new Error('Gateway tunnel ownership changed.');
  const existing = await api(`${prefix}/cfd_tunnel/${gateway.tunnelId}/configurations`);
  const ingress = existing.config?.ingress ?? [];
  const current = ingress.filter((route) => route.hostname === hostname);
  if (current.some((route) => route.service !== 'http://127.0.0.1:3001')) throw new Error('Media tunnel route conflicts with this service.');
  const retained = ingress.filter((route) => route.hostname !== hostname);
  if (!retained.length || retained.at(-1).hostname) throw new Error('Tunnel requires its existing final catch-all route.');
  await api(`${prefix}/cfd_tunnel/${gateway.tunnelId}/configurations`, 'PUT', {
    config: { ...existing.config, ingress: [{ hostname, service: 'http://127.0.0.1:3001' }, ...retained] },
  });
  if (!records.length) await api(dnsPath, 'POST', { type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 });
  let local = await readFile('.dev.vars', 'utf8');
  local = local.split('\n').filter((line) => !/^(MEDIA_PREPARATION_URL|MEDIA_PREPARATION_KEY)=/.test(line)).join('\n').trimEnd();
  await writeFile('.dev.vars', `${local}\nMEDIA_PREPARATION_URL=${origin}\nMEDIA_PREPARATION_KEY=${key}\n`, { mode: 0o600 });
  await chmod('.dev.vars', 0o600);
  state.origin = origin;
  state.configuredAt = new Date().toISOString();
  await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log('Media Access, DNS, tunnel route and local environment configured. Existing routes preserved.');
}

async function verify(remote = false) {
  const base = remote ? origin : 'http://127.0.0.1:3001';
  const headers = { Authorization: `Bearer ${key}` };
  if (remote) {
    headers['CF-Access-Client-Id'] = gateway.clientId;
    headers['CF-Access-Client-Secret'] = gateway.clientSecret;
  }
  const request = (body, mime, auth = headers) => fetch(`${base}/prepare`, {
    method: 'POST', headers: { ...auth, 'Content-Type': mime }, body,
    redirect: 'manual', signal: AbortSignal.timeout(120000),
  });
  const sharp = createRequire(import.meta.url)('../infra/media-preparation/node_modules/sharp');
  const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 0, g: 128, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const unauthorized = await request(png, 'image/png', {});
  if (!(remote ? [302, 401, 403] : [401]).includes(unauthorized.status)) throw new Error(`Unauthenticated media request returned HTTP ${unauthorized.status}.`);
  await unauthorized.body?.cancel();
  if (remote) {
    for (const auth of [{ Authorization: headers.Authorization }, { 'CF-Access-Client-Id': gateway.clientId, 'CF-Access-Client-Secret': gateway.clientSecret }]) {
      const response = await request(png, 'image/png', auth);
      if (![302, 401, 403].includes(response.status)) throw new Error('Media authentication can be bypassed.');
      await response.body?.cancel();
    }
  }
  const dir = await mkdtemp(join(tmpdir(), 'retarget-media-check-'));
  try {
    const video = join(dir, 'video.mp4');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x48:d=1', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=1', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', video]);
    for (const [body, mime, expected] of [[png, 'image/png', 'image/jpeg'], [await readFile(video), 'video/mp4', 'video/mp4']]) {
      const response = await request(body, mime);
      if (!response.ok || response.headers.get('content-type') !== expected) throw new Error(`${mime} preparation returned HTTP ${response.status}.`);
      const output = Buffer.from(await response.arrayBuffer());
      if (response.headers.get('x-media-checksum') !== createHash('sha256').update(output).digest('hex')) throw new Error('Preparation checksum does not match.');
      console.log(`${remote ? 'Protected remote' : 'Local'} ${mime} preparation and checksum verified (${output.length} bytes).`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

try {
  const command = process.argv[2];
  if (command === 'setup') await setup();
  else if (command === 'start') { await initialize(); await compose('up', '-d', '--build'); }
  else if (command === 'stop') await compose('stop');
  else if (command === 'status') await compose('ps');
  else if (command === 'verify') await verify(process.argv.includes('--remote'));
  else throw new Error('Use setup, start, stop, status, or verify.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
