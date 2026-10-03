import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function run(command, args = [], { capture = false, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false', ...env },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} ${args.join(' ')} failed (${code}).\n${stderr || stdout}`));
    });
  });
}

export const npm = (...args) => run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args);
export const wrangler = (args, options) => {
  if (args.includes('--local')) throw new Error('Re-Target uses the shared production database; local database commands are disabled.');
  return run(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], options);
};
export const astro = (args, options) => run(process.execPath, ['node_modules/astro/bin/astro.mjs', ...args], options);
