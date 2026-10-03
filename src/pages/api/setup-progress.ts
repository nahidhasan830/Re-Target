import type { APIRoute } from 'astro';
import { requireAccount } from '../../lib/auth';
import { json } from '../../lib/http';
import { setupProgress } from '../../lib/setup-dashboard';

export const GET: APIRoute = async ({ cookies }) => json(await setupProgress(await requireAccount(cookies)));
