import type { APIRoute } from 'astro';
import { z } from 'zod';
import { limitLogin, requireAdmin, requireSameOrigin } from '../../../lib/auth';
import { HttpError, json, readJson } from '../../../lib/http';
import { resendInvitation, revokeInvitation } from '../../../lib/invitations';

export const POST: APIRoute = async ({ cookies, request, params, url }) => {
  requireSameOrigin(request);
  const admin = await requireAdmin(cookies);
  if (!z.uuid().safeParse(params.id).success) throw new HttpError(404, 'Invitation not found.');
  const input = z.discriminatedUnion('action', [
    z.object({ action: z.literal('resend'), requestId: z.uuid() }).strict(),
    z.object({ action: z.literal('revoke') }).strict(),
  ]).safeParse(await readJson(request));
  if (!input.success) throw new HttpError(400, 'Invalid invitation request.');
  await limitLogin(request, `invitations:${admin.id}`, 20);
  return json(input.data.action === 'revoke' ? await revokeInvitation(params.id!)
    : await resendInvitation(admin, params.id!, input.data.requestId, url.origin));
};
