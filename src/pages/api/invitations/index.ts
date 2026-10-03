import type { APIRoute } from 'astro';
import { z } from 'zod';
import { limitLogin, requireAdmin, requireSameOrigin } from '../../../lib/auth';
import { localPhoneInput } from '../../../lib/account-validation';
import { HttpError, json, readJson } from '../../../lib/http';
import { inviteUser, listInvitations } from '../../../lib/invitations';

export const GET: APIRoute = async ({ cookies, url }) => {
  await requireAdmin(cookies);
  return json(await listInvitations(true, url.searchParams.get('cursor') ?? undefined));
};

export const POST: APIRoute = async ({ cookies, request, url }) => {
  requireSameOrigin(request);
  const admin = await requireAdmin(cookies);
  const input = z.object({ phone: localPhoneInput, requestId: z.uuid() }).strict().safeParse(await readJson(request));
  if (!input.success) throw new HttpError(400, input.error.issues[0].message);
  await limitLogin(request, `invitations:${admin.id}`, 20);
  return json(await inviteUser(admin, input.data.phone, input.data.requestId, url.origin), 201);
};
