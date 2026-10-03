import type { APIRoute } from 'astro';
import { serveAsset,tokenAsset } from '../../../lib/campaign-media';
export const GET:APIRoute=async({params,request})=>serveAsset(await tokenAsset(params.token!),request);
export const HEAD=GET;
