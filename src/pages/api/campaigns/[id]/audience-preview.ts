import type { APIRoute } from 'astro';
import { requireAccount,requireSameOrigin } from '../../../../lib/auth';
import { json } from '../../../../lib/http';
import { getCampaign } from '../../../../lib/campaigns';
import { previewAudience } from '../../../../lib/campaign-audience';
export const POST:APIRoute=async({cookies,params,request})=>{const account=await requireAccount(cookies);requireSameOrigin(request);const campaign=await getCampaign(account.id,params.id!);return json(await previewAudience(account.id,JSON.parse(campaign.audience_json)));};
