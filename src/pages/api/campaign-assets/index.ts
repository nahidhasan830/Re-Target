import type { APIRoute } from 'astro';
import { requireAccount,requireSameOrigin } from '../../../lib/auth';
import { json } from '../../../lib/http';
import { uploadAsset,listAssets } from '../../../lib/campaign-media';
export const POST:APIRoute=async({cookies,request})=>{const account=await requireAccount(cookies);requireSameOrigin(request);const asset=await uploadAsset(account,request);return json({id:asset.id,kind:asset.kind,name:asset.original_name,mime:asset.mime,bytes:asset.bytes,state:asset.state,width:asset.width,height:asset.height,background:asset.background},201);};

export const GET:APIRoute=async({cookies,url})=>json(await listAssets((await requireAccount(cookies)).id,url.searchParams));
