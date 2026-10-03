import type { APIRoute } from 'astro';
import { destroySession, requireSameOrigin } from '../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  requireSameOrigin(request);
  await destroySession(cookies, url);
  return redirect('/', 303);
};
