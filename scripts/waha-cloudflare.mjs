import { chmod, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root, run, wrangler } from './commands.mjs';
import { readSettings } from './waha.mjs';
import { cloudflareApi as api } from './cloudflare-api.mjs';

process.chdir(root);
process.umask(0o077);
const stateDirectory = '.waha';
const hostname = 'waha.nahidlabs.com';
const name = 're-target-waha';
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const prefix = `/accounts/${config.account_id}`;
const stateFile = `${stateDirectory}/cloudflare.json`;
let state = {};
try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

async function save() {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}


async function setup() {
  await readSettings();
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const apps = await api(`${prefix}/access/apps?per_page=100`);
  const tunnels = await api(`${prefix}/cfd_tunnel?is_deleted=false&per_page=100`);
  const matches = apps.filter((app) => app.domain === hostname);
  if (matches.some((app) => app.id !== state.appId)) throw new Error(`${hostname} already has an Access application not owned by this setup.`);
  const tokens = await api(`${prefix}/access/service_tokens?per_page=100`);
  if (!state.serviceTokenId) {
    if (tokens.some((token) => token.name === name)) throw new Error('An existing WAHA service token has no locally saved secret. Recover it or explicitly rotate it before retrying.');
    const token = await api(`${prefix}/access/service_tokens`, 'POST', { name, duration: '8760h' });
    state.serviceTokenId = token.id;
    state.clientId = token.client_id;
    state.clientSecret = token.client_secret;
    state.serviceTokenExpiresAt = token.expires_at;
    await save();
  }
  if (!tokens.some((token) => token.id === state.serviceTokenId) && tokens.some((token) => token.name === name)) {
    throw new Error('WAHA service token state does not match Cloudflare.');
  }
  if (!state.appId) {
    const app = await api(`${prefix}/access/apps`, 'POST', {
      name: 'Re-Target WAHA', type: 'self_hosted', domain: hostname,
      app_launcher_visible: false,
      policies: [{ name: 'Re-Target backend only', decision: 'non_identity',
        include: [{ service_token: { token_id: state.serviceTokenId } }], exclude: [], require: [] }],
    });
    state.appId = app.id;
    await save();
  }
  const policies = await api(`${prefix}/access/apps/${state.appId}/policies`);
  if (policies.length !== 1 || policies[0].decision !== 'non_identity'
    || policies[0].include?.length !== 1 || policies[0].include[0].service_token?.token_id !== state.serviceTokenId) {
    throw new Error('WAHA Access policy must allow only its dedicated service token. Publication stopped.');
  }
  if (!state.tunnelId) {
    if (tunnels.some((tunnel) => tunnel.name === name)) throw new Error('An existing WAHA tunnel is not owned by this setup. Recover its local state before retrying.');
    const tunnel = await api(`${prefix}/cfd_tunnel`, 'POST', { name, config_src: 'cloudflare' });
    state.tunnelId = tunnel.id;
    await save();
    if (tunnel.token) await writeFile(`${stateDirectory}/tunnel-token`, tunnel.token, { mode: 0o600 });
  }
  const current = await api(`${prefix}/cfd_tunnel/${state.tunnelId}`);
  if (current.name !== name || current.config_src !== 'cloudflare') throw new Error('WAHA tunnel ownership or management type changed.');
  const existing = await api(`${prefix}/cfd_tunnel/${state.tunnelId}/configurations`);
  const ingress = existing.config?.ingress ?? [{ service: 'http_status:404' }];
  const retained = ingress.filter((route) => route.hostname !== hostname);
  await api(`${prefix}/cfd_tunnel/${state.tunnelId}/configurations`, 'PUT', {
    config: { ...existing.config, ingress: [{ hostname, service: 'http://127.0.0.1:3000' }, ...retained] },
  });
  const tunnelToken = await api(`${prefix}/cfd_tunnel/${state.tunnelId}/token`);
  await writeFile(`${stateDirectory}/tunnel-token`, tunnelToken, { mode: 0o600 });
  const settings = await readSettings();
  const secrets = { WAHA_BASE_URL: `https://${hostname}`, WAHA_API_KEY: settings.WAHA_API_KEY,
    CF_ACCESS_CLIENT_ID: state.clientId, CF_ACCESS_CLIENT_SECRET: state.clientSecret };
  await writeFile(`${stateDirectory}/worker-secrets.json`, JSON.stringify(secrets), { mode: 0o600 });
  let local = '';
  try { local = await readFile('.dev.vars', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  local = local.split('\n').filter((line) => !Object.keys(secrets).some((key) => line.startsWith(`${key}=`))).join('\n').trimEnd();
  const localSecrets = { ...secrets, WAHA_BASE_URL: 'http://127.0.0.1:3000' };
  await writeFile('.dev.vars', `${local}\n${Object.entries(localSecrets).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
  await chmod('.dev.vars', 0o600);
  console.log('Dedicated Access application, service token, tunnel, and private backend configuration prepared.');
  const zones = await api('/zones?name=nahidlabs.com');
  if (zones.length !== 1) throw new Error('Expected one nahidlabs.com zone.');
  const dnsPath = `/zones/${zones[0].id}/dns_records`;
  let records;
  try { records = await api(`${dnsPath}?name=${hostname}`); }
  catch (error) {
    if (error.status !== 403) throw error;
    throw new Error(`DNS permission is missing. Add a proxied CNAME: ${hostname} → ${state.tunnelId}.cfargotunnel.com, then run npm run waha:tunnel and node scripts/waha-cloudflare.mjs publish-secrets. Existing tunnels were preserved.`);
  }
  const target = `${state.tunnelId}.cfargotunnel.com`;
  if (records.length) {
    if (records.length !== 1 || records[0].type !== 'CNAME' || records[0].content !== target || !records[0].proxied) {
      throw new Error(`${hostname} has a conflicting DNS record; it was not changed.`);
    }
  } else await api(dnsPath, 'POST', { type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 });
  state.dnsReady = true;
  await save();
  await start();
  await publishSecrets();
}

async function runningPid() {
  try {
    const pid = Number(await readFile(`${stateDirectory}/tunnel.pid`, 'utf8'));
    const args = await run('ps', ['-p', String(pid), '-o', 'args='], { capture: true });
    return args.includes('cloudflared') && args.includes(`${root}.waha/tunnel-token`) ? pid : undefined;
  } catch { return undefined; }
}

async function start() {
  if (await runningPid()) { console.log('WAHA tunnel is already running.'); return; }
  await readFile(`${stateDirectory}/tunnel-token`, 'utf8');
  await writeFile(`${stateDirectory}/tunnel-config.yml`, '{}\n', { mode: 0o600 });
  const log = await open(`${stateDirectory}/tunnel.log`, 'a', 0o600);
  const child = spawn('cloudflared', ['--no-autoupdate', 'tunnel', '--config', `${root}.waha/tunnel-config.yml`,
    'run', '--token-file', `${root}.waha/tunnel-token`], { detached: true, stdio: ['ignore', log.fd, log.fd] });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  await log.close();
  await writeFile(`${stateDirectory}/tunnel.pid`, String(child.pid), { mode: 0o600 });
  await delay(2000);
  if (!(await runningPid())) throw new Error('WAHA tunnel exited; inspect .waha/tunnel.log locally.');
  console.log('Dedicated WAHA tunnel started.');
}

async function stop() {
  const pid = await runningPid();
  if (pid) process.kill(pid, 'SIGTERM');
  await rm(`${stateDirectory}/tunnel.pid`, { force: true });
}

async function publishSecrets() {
  await run(process.execPath, ['scripts/waha.mjs', 'verify', '--remote']);
  await wrangler(['secret', 'bulk', `${stateDirectory}/worker-secrets.json`, '--config', 'wrangler.jsonc'], { capture: true });
  console.log('Four WAHA backend secrets uploaded to the existing Re-Target Worker.');
}

const command = process.argv[2];
try {
  if (command === 'setup') await setup();
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'publish-secrets') await publishSecrets();
  else throw new Error('Use setup, start, stop, or publish-secrets.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
