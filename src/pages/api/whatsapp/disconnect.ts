import type { APIRoute } from 'astro';
import { limitLogin, requireAccount, requireSameOrigin } from '../../../lib/auth';
import { HttpError, json, readJson } from '../../../lib/http';
import { disconnectAccountWhatsApp } from '../../../lib/whatsapp-connections';

export const POST: APIRoute = async ({ cookies, request }) => {
  requireSameOrigin(request);
  const account = await requireAccount(cookies);
  const input = await readJson(request);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new HttpError(400, 'Invalid connection request.');
  await limitLogin(request, `whatsapp:${account.id}`, 30);
  return json(await disconnectAccountWhatsApp(account));
};
