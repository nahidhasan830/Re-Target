import { chmod, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

async function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    await chmod('.waha/cloudflare-api-token', 0o600);
    return (await readFile('.waha/cloudflare-api-token', 'utf8')).trim();
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const path = process.platform === 'darwin'
    ? join(homedir(), 'Library/Preferences/.wrangler/config/default.toml')
    : join(homedir(), '.config/.wrangler/config/default.toml');
  const token = (await readFile(path, 'utf8')).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error('Run npx wrangler login or configure a private .waha/cloudflare-api-token file.');
  return token;
}

export async function cloudflareApi(path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method, headers: { Authorization: `Bearer ${await apiToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    const error = new Error(`Cloudflare ${method} ${path}: HTTP ${response.status}; ${(data.errors ?? []).map((entry) => entry.message).join('; ')}`);
    error.status = response.status;
    throw error;
  }
  return data.result;
}
