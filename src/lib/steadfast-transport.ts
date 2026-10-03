import { CourierAuthError, courierText, type CourierFetcher } from './courier-auth';

export function steadfastTransport(endpoint: string | undefined, token: string | undefined, fetcher: CourierFetcher = fetch): CourierFetcher {
  if (!endpoint && !token) return fetcher;
  let transport: URL;
  try {
    transport = new URL(endpoint ?? '');
    if (transport.protocol !== 'https:' || transport.username || transport.password || transport.search || transport.hash || !token) throw new Error();
  } catch { throw new CourierAuthError(503, 'Steadfast server transport is not configured correctly.'); }
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    if (url.origin !== 'https://steadfast.com.bd' || url.username || url.password || url.hash ||
      (method === 'POST' ? url.pathname !== '/login' || Boolean(url.search) : method !== 'GET' || !((['/login', '/user/frauds/create'].includes(url.pathname) || /^\/user\/consignment\/\d+$/.test(url.pathname)) && !url.search || url.pathname === '/user/consignment/status/delivered' && [...url.searchParams.keys()].every(key => key === 'cursor') && url.searchParams.getAll('cursor').length <= 1 && (!url.searchParams.has('cursor') || /^[A-Za-z0-9_=-]{1,2048}$/.test(url.searchParams.get('cursor')!))))) {
      throw new CourierAuthError(400, 'Invalid Steadfast transport request.');
    }
    let response;
    try {
      response = await fetcher(transport, {
        method: 'POST', redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.href, method, headers: Object.fromEntries(new Headers(init.headers)), ...(init.body ? { body: String(init.body) } : {}) }),
      });
    } catch { throw new CourierAuthError(502, 'Steadfast server transport could not be reached. Try again shortly.'); }
    const text = await courierText(response, 2 * 1024 * 1024);
    if (!response.ok) throw new CourierAuthError(502, 'Steadfast server transport is unavailable. Try again shortly.');
    let data;
    try { data = JSON.parse(text); } catch { throw new CourierAuthError(502, 'Steadfast server transport returned an unexpected response.'); }
    if (!Number.isInteger(data?.status) || data.status < 200 || data.status > 599 || typeof data.body !== 'string' || data.body.length > 1024 * 1024 ||
      !Array.isArray(data.cookies) || !data.cookies.every((cookie: unknown) => typeof cookie === 'string' && cookie.length <= 16384 && !/[\r\n]/.test(cookie)) ||
      (data.location !== null && data.location !== undefined && (typeof data.location !== 'string' || /[\r\n]/.test(data.location)))) {
      throw new CourierAuthError(502, 'Steadfast server transport returned an unexpected response.');
    }
    const headers = new Headers();
    for (const cookie of data.cookies) headers.append('Set-Cookie', cookie);
    if (typeof data.type === 'string') headers.set('Content-Type', data.type);
    if (data.location) headers.set('Location', data.location);
    return new Response([204, 205, 304].includes(data.status) ? null : data.body, { status: data.status, headers });
  };
}
