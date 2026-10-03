import type { APIRoute } from 'astro';
import { requireAccount,requireSameOrigin } from '../../../lib/auth';
import { json,readJson } from '../../../lib/http';
import { createDraft,listCampaigns } from '../../../lib/campaigns';
import { LIMITS } from '../../../lib/campaign-content';
export const GET:APIRoute=async({cookies,url})=>json(await listCampaigns((await requireAccount(cookies)).id,url));
export const POST:APIRoute=async({cookies,request})=>{const account=await requireAccount(cookies);requireSameOrigin(request);return json(await createDraft(account,await readJson(request,LIMITS.json)),201);};
