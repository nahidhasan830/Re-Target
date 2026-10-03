import type { APIRoute } from 'astro';
import { requireAccount,requireSameOrigin } from '../../../../lib/auth';
import { json,readJson } from '../../../../lib/http';
import { detailCampaign,editDraft,deleteCampaign } from '../../../../lib/campaigns';
import { z } from 'zod';
import { LIMITS } from '../../../../lib/campaign-content';
export const GET:APIRoute=async({cookies,params})=>json(await detailCampaign((await requireAccount(cookies)).id,params.id!));
export const PATCH:APIRoute=async({cookies,params,request})=>{const account=await requireAccount(cookies);requireSameOrigin(request);return json(await editDraft(account,params.id!,await readJson(request,LIMITS.json)));};

export const DELETE:APIRoute=async({cookies,params,request})=>{
  const account=await requireAccount(cookies);
  requireSameOrigin(request);
  const input=z.object({revision:z.number().int().positive()}).strict().safeParse(await readJson(request));
  if(!input.success)return json({error:'Reload this campaign before deleting it.'},400);
  return json(await deleteCampaign(account,params.id!,input.data.revision));
};
