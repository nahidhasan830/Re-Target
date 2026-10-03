import type { APIRoute } from 'astro';
import { requireAccount } from '../../../../lib/auth';
import { json } from '../../../../lib/http';
import { campaignProgress } from '../../../../lib/campaigns';

export const GET: APIRoute = async ({ cookies, params }) =>
  json(await campaignProgress((await requireAccount(cookies)).id, params.id!));
