import type { APIRoute } from 'astro';
import { requireAccount } from '../../../lib/auth';
import { json } from '../../../lib/http';
import { leadCheckStatus } from '../../../lib/leads';

export const GET: APIRoute = async ({ cookies, url }) => json(await leadCheckStatus((await requireAccount(cookies)).id, url));
