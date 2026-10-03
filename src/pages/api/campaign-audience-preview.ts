import type { APIRoute } from 'astro';
import { requireAccount, requireSameOrigin } from '../../lib/auth';
import { json, readJson } from '../../lib/http';
import { campaignAudienceInput } from '../../lib/campaign-content';
import { previewAudience } from '../../lib/campaign-audience';
export const POST: APIRoute = async ({ cookies, request }) => {
  const account = await requireAccount(cookies);
  requireSameOrigin(request);
  const parsed = campaignAudienceInput.safeParse(
    await readJson(request, 32768),
  );
  if (!parsed.success)
    return json({ error: 'Check the audience filters.' }, 400);
  const query = new URL(request.url).searchParams;
  return json(await previewAudience(account.id, parsed.data, Number(query.get('page') ?? 1), Number(query.get('size') ?? 25)));
};
