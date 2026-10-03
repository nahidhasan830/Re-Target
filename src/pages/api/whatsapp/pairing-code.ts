import type { APIRoute } from 'astro';
import { z } from 'zod';
import { limitLogin, requireAccount, requireSameOrigin } from '../../../lib/auth';
import { localPhoneInput } from '../../../lib/account-validation';
import { HttpError, json, readJson } from '../../../lib/http';
import { accountPairingCode } from '../../../lib/whatsapp-connections';

export const POST: APIRoute = async ({ cookies, request }) => {
  requireSameOrigin(request);
  const account = await requireAccount(cookies);
  const input = z.object({ phone: localPhoneInput }).strict().safeParse(await readJson(request));
  if (!input.success) throw new HttpError(400, input.error.issues[0].message);
  await limitLogin(request, `pairing:${account.id}`, 5);
  return json(await accountPairingCode(account, input.data.phone));
};
