import type { APIRoute } from 'astro';
import { requireAccount,requireSameOrigin } from '../../../lib/auth';
import { json } from '../../../lib/http';
import { getAsset,serveAsset,deleteAsset } from '../../../lib/campaign-media';
export const GET:APIRoute=async({cookies,params,request})=>serveAsset(await getAsset((await requireAccount(cookies)).id,params.id!),request);
export const HEAD=GET;
export const DELETE:APIRoute=async({cookies,params,request})=>{const account=await requireAccount(cookies);requireSameOrigin(request);return json(await deleteAsset(account.id,params.id!));};
