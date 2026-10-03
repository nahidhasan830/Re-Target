import type { APIRoute } from 'astro';
import { requireAccount,requireSameOrigin } from '../../../../lib/auth';
import { json,readJson } from '../../../../lib/http';
import { createCampaignTest,testSendInput } from '../../../../lib/campaign-tests';
export const POST:APIRoute=async({cookies,params,request})=>{const account=await requireAccount(cookies);requireSameOrigin(request);const parsed=testSendInput.safeParse(await readJson(request));if(!parsed.success)return json({error:'Choose one or more configured test receivers and a saved campaign revision.'},400);return json(await createCampaignTest(account,params.id!,parsed.data),202);};
