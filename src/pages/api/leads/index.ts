import type { APIRoute } from 'astro';
import { requireAccount, requireSameOrigin } from '../../../lib/auth';
import { json, readJson } from '../../../lib/http';
import { exclusionInput, listLeads, setExclusions } from '../../../lib/leads';

export const GET: APIRoute = async ({ cookies, url }) => json(await listLeads((await requireAccount(cookies)).id, url));
export const PATCH: APIRoute = async ({ cookies, request }) => {
  const account = await requireAccount(cookies);
  requireSameOrigin(request);
  const input = exclusionInput.safeParse(await readJson(request));
  if (!input.success) return json({ error: 'Choose 1–50 leads and a valid contact preference.' }, 400);
  return json(await setExclusions(account.id, input.data));
};
