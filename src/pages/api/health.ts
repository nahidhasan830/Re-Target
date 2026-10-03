import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { databaseReady } from '../../db';
import { json } from '../../lib/http';

export const GET: APIRoute = async () => {
  try {
    await Promise.all([databaseReady(), env.MEDIA.head('__healthcheck__')]);
    const response = json({ status: 'ok' });
    response.headers.set('X-Deployment-Id', env.DEPLOYMENT_ID);
    return response;
  } catch {
    return json({ status: 'unavailable' }, 503);
  }
};
