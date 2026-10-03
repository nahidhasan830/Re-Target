import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let temporary;
let gitArgs = [];
try { execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, stdio: 'ignore' }); }
catch {
  temporary = await mkdtemp(join(tmpdir(), 'retarget-upload-check-'));
  execFileSync('git', ['init', '--bare', temporary], { stdio: 'ignore' });
  gitArgs = [`--git-dir=${temporary}`, `--work-tree=${root}`];
}
try {
  const files = execFileSync('git', [...gitArgs, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 10 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
  const secrets = new Set();
  for (const name of ['.dev.vars', '.env', 'infra/waha/.env', 'infra/media-preparation/.env', 'infra/steadfast-transport/.env.local', '.deploy/production-secrets.json']) {
    let source;
    try { source = await readFile(join(root, name), 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const values = name.endsWith('.json') ? Object.entries(JSON.parse(source)) : [...source.matchAll(/^([A-Z_]+)\s*=\s*(.+)$/gm)].map((m) => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]);
    for (const [key, value] of values) {
      if (/TOKEN|SECRET|PASSWORD|API_KEY|ENCRYPTION_KEY|PREPARATION_KEY/.test(key) && typeof value === 'string' && value.length >= 8 && !/replace-with-|^<|^your-/i.test(value)) secrets.add(value);
    }
  }
  const findings = [];
  const privatePath = /(^|\/)(?:\.env(?:\..+)?|\.dev\.vars(?:\..+)?|\.deploy|\.waha|\.impeccable|artifacts|backups|\.vercel)(?:\/|$)|\.(?:pem|key|p12|pfx|sqlite\w*|db)$/;
  const credentials = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/;
  for (const name of new Set(files)) {
    if (privatePath.test(name) && !name.endsWith('.example')) findings.push(`${name}: private file included in upload`);
    const bytes = await readFile(join(root, name));
    if (bytes.includes(0)) continue;
    const lines = bytes.toString().split('\n');
    lines.forEach((line, index) => {
      if (credentials.test(line) || [...secrets].some((secret) => line.includes(secret))) findings.push(`${name}:${index + 1}: possible credential exposure`);
    });
  }
  if (findings.length) {
    console.error([...new Set(findings)].join('\n'));
    process.exitCode = 1;
  } else console.log(`Security upload check passed (${new Set(files).size} candidate files).`);
} finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
