import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, json } from './lib/http';

async function authorize(request: Request) {
  const secret = env.ADMIN_API_TOKEN;
  if (!secret || secret.length < 32 || secret.startsWith('replace-with-')) {
    throw new HttpError(503, 'The admin API is not configured.');
  }
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'Unauthorized.');
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(authorization.slice(7))),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  if (!timingSafeEqual(new Uint8Array(actual), new Uint8Array(expected))) throw new HttpError(401, 'Unauthorized.');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const requestId = crypto.randomUUID();
  let response: Response;
  try {
    let pathname: string;
    try { pathname = decodeURIComponent(context.url.pathname); }
    catch { throw new HttpError(400, 'Invalid request path.'); }
    if (pathname === '/api/products' || pathname.startsWith('/api/products/')) {
      await authorize(context.request);
    }
    response = await next();
  } catch (error) {
    if (error instanceof HttpError) {
      response = json({ error: error.message }, error.status);
    } else {
      console.error(JSON.stringify({ event: 'request_failed', requestId }));
      response = json({ error: 'Internal server error.', requestId }, 500);
    }
  }
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Native form posts need Origin; origin-only referrers keep invitation tokens private.
  response.headers.set('Referrer-Policy', context.url.pathname.startsWith('/invite/') ? 'strict-origin' : 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (context.url.protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  response.headers.set('Cache-Control', 'no-store');
  if (response.status === 401 && context.url.pathname.startsWith('/api/products')) response.headers.set('WWW-Authenticate', 'Bearer');
  return response;
});
