import type { APIRoute } from 'astro';
import { requireAccount, requireSameOrigin, limitLogin } from '../../../lib/auth';
import { HttpError, json } from '../../../lib/http';
import { startSync, syncStatus } from '../../../lib/lead-sync';

export const GET: APIRoute = async ({ cookies }) => json({ providers: await syncStatus((await requireAccount(cookies)).id) });
export const POST: APIRoute = async ({ cookies, request }) => {
  const account = await requireAccount(cookies);
  requireSameOrigin(request);
  await limitLogin(request, `lead-sync:${account.id}`, 10);
  const providers = await syncStatus(account.id);
  let started = 0;
  const errors: string[] = [];
  for (const provider of providers) {
    if (!provider.syncAvailable) continue;
    try { await startSync(account, provider.provider); started++; }
    catch (error) { errors.push(error instanceof HttpError ? error.message : 'Could not start the courier import. Try again shortly.'); }
  }
  return json({ providers: await syncStatus(account.id), ...(!started ? { error: errors.join(' ') || 'Connect a courier in Courier settings to import leads.' } : {}) }, started ? 202 : 400);
};
