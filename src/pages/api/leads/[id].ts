import type { APIRoute } from 'astro';
import { requireAccount } from '../../../lib/auth';
import { json } from '../../../lib/http';
import { leadHistory } from '../../../lib/leads';
export const GET: APIRoute = async ({ cookies, params, url }) => json(await leadHistory((await requireAccount(cookies)).id, params.id!, url));
