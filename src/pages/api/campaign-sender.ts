import type { APIRoute } from 'astro';
import { requireAccount, requireSameOrigin } from '../../lib/auth';
import { json, readJson } from '../../lib/http';
import {
  senderReviewState,
  reviewSender,
  senderReviewInput,
} from '../../lib/campaign-sender';
export const GET: APIRoute = async ({ cookies }) =>
  json(await senderReviewState(await requireAccount(cookies)));
export const POST: APIRoute = async ({ cookies, request }) => {
  const account = await requireAccount(cookies);
  requireSameOrigin(request);
  const input = senderReviewInput.safeParse(await readJson(request));
  if (!input.success)
    return json({ error: 'Record the sender review evidence.' }, 400);
  return json(await reviewSender(account, input.data));
};
