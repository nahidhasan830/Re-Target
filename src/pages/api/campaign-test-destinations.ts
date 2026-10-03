import type { APIRoute } from 'astro';
import { requireAccount, requireSameOrigin } from '../../lib/auth';
import { json, readJson } from '../../lib/http';
import {
  testDestinations,
  saveTestDestinations,
  testDestinationsInput,
} from '../../lib/campaign-contact-settings';
export const GET: APIRoute = async ({ cookies }) =>
  json({ items: await testDestinations(await requireAccount(cookies)) });
export const POST: APIRoute = async ({ cookies, request }) => {
  const account = await requireAccount(cookies);
  requireSameOrigin(request);
  const parsed = testDestinationsInput.safeParse(await readJson(request));
  if (!parsed.success)
    return json(
      { error: 'Enter up to 10 local test numbers.' },
      400,
    );
  return json({ items: await saveTestDestinations(account, parsed.data) });
};
