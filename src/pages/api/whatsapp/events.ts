import type { APIRoute } from 'astro';
import { json } from '../../../lib/http';
import { receiveWhatsAppEvent } from '../../../lib/campaign-events';
export const POST:APIRoute=async({request})=>json(await receiveWhatsAppEvent(request));
