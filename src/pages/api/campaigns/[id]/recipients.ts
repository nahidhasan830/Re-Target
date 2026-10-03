import type { APIRoute } from 'astro';
import { requireAccount } from '../../../../lib/auth';
import { json } from '../../../../lib/http';
import { listRecipients } from '../../../../lib/campaigns';
export const GET:APIRoute=async({cookies,params,url})=>json(await listRecipients((await requireAccount(cookies)).id,params.id!,url));
