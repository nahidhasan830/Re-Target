import type { APIRoute } from 'astro';
import { requireAccount,requireSameOrigin } from '../../../../lib/auth';
import { json,readJson } from '../../../../lib/http';
import { campaignAction,actionInput } from '../../../../lib/campaigns';
export const POST:APIRoute=async({cookies,params,request})=>{const account=await requireAccount(cookies);requireSameOrigin(request);const parsed=actionInput.safeParse(await readJson(request));if(!parsed.success)return json({error:'Check the action, revision, and recovery evidence.'},400);return json(await campaignAction(account,params.id!,parsed.data));};
