export type MerchantCredentials = { username: string; password: string };
export type PathaoSession = { provider: 'pathao'; accessToken: string; refreshToken: string; expiresAt: number };
type Cookie = { value: string; expiresAt: number | null };
export type SteadfastSession = { provider: 'steadfast'; cookies: Record<string, Cookie>; expiresAt: number };
export type CourierSession = PathaoSession | SteadfastSession;
export type CourierFetcher = typeof fetch;
export class CourierAuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const courierOrigins = { pathao: 'https://merchant.pathao.com', steadfast: 'https://steadfast.com.bd' };
const sessionCookies = ['sfc_user_session', 'steadfast_courier_session'];
const steadfastCheck = '/user/frauds/create';
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

export async function courierText(response: Response, maximum = 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let bytes = 0, result = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new CourierAuthError(502, 'The courier returned an oversized response. Try again later.'); }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function send(url: string, init: RequestInit, fetcher: CourierFetcher) {
  try { return await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(12000) }); }
  catch (error) { if (error instanceof CourierAuthError) throw error; throw new CourierAuthError(502, 'The courier could not be reached. Try again shortly.'); }
}

function upstreamFailure(status: number, provider: string) {
  if (status === 429) return new CourierAuthError(429, `${provider} is limiting requests. Try again later.`);
  if (status === 403) return new CourierAuthError(502, `${provider} blocked the server connection. Try again later.`);
  return new CourierAuthError(502, `${provider} is unavailable. Try again shortly.`);
}

export async function renewPathao(credentials: MerchantCredentials, cached?: PathaoSession | null, fetcher: CourierFetcher = fetch): Promise<PathaoSession> {
  const refreshing = Boolean(cached?.refreshToken);
  const response = await send(`${courierOrigins.pathao}/api/v1/login`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(refreshing ? { grant_type: 'refresh_token', refresh_token: cached!.refreshToken } : { username: credentials.username, password: credentials.password }),
  }, fetcher);
  const text = await courierText(response, 65536);
  if ([400, 401, 422].includes(response.status)) throw new CourierAuthError(401, refreshing ? 'Pathao renewal was refused. Reconnect your merchant account.' : 'Pathao refused the email or password. Check your merchant login.');
  if (!response.ok) throw upstreamFailure(response.status, 'Pathao');
  let data;
  try { data = JSON.parse(text); } catch { throw new CourierAuthError(502, 'Pathao returned an unexpected login response. Try again later.'); }
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
    throw new CourierAuthError(502, 'Pathao returned an unexpected login response. Try again later.');
  }
  return { provider: 'pathao', accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
}

export function mergeSteadfastCookies(record: SteadfastSession | null | undefined, lines: string[], now = Date.now()): SteadfastSession {
  const cookies: Record<string, Cookie> = { ...record?.cookies };
  for (const line of lines) {
    const [pair, ...attributes] = line.split(';');
    const equal = pair.indexOf('=');
    if (equal < 1) continue;
    const name = pair.slice(0, equal).trim(), value = pair.slice(equal + 1).trim();
    if (!sessionCookies.includes(name) && name !== 'XSRF-TOKEN' && !name.startsWith('remember_web_')) continue;
    const attrs = new Map(attributes.map(attribute => {
      const at = attribute.indexOf('=');
      return [attribute.slice(0, at < 0 ? undefined : at).trim().toLowerCase(), at < 0 ? '' : attribute.slice(at + 1).trim()];
    }));
    const maxAge = attrs.has('max-age') ? Number(attrs.get('max-age')) : NaN;
    const expiresAt = Number.isFinite(maxAge) ? now + maxAge * 1000 : Date.parse(attrs.get('expires') ?? '');
    if (!value || (Number.isFinite(expiresAt) && expiresAt <= now)) delete cookies[name];
    else cookies[name] = { value, expiresAt: Number.isFinite(expiresAt) ? expiresAt : sessionCookies.includes(name) ? now + 7200000 : null };
  }
  for (const [name, cookie] of Object.entries(cookies)) if (cookie.expiresAt !== null && cookie.expiresAt <= now) delete cookies[name];
  const active = sessionCookies.find(name => cookies[name]);
  return { provider: 'steadfast', cookies, expiresAt: active ? cookies[active].expiresAt ?? record?.expiresAt ?? 0 : 0 };
}

export function steadfastCookieHeader(session: SteadfastSession) {
  return Object.entries(session.cookies).filter(([, cookie]) => cookie.expiresAt === null || cookie.expiresAt > Date.now()).map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
}

function csrfFrom(html: string) {
  const input = /<input[^>]*\bname=["']_token["'][^>]*>/i.exec(html)?.[0] ?? '';
  return /\bvalue=["']([^"']+)["']/i.exec(input)?.[1] ?? '';
}

export function steadfastNeedsLogin(response: Response, html = '') {
  if ([401, 419].includes(response.status) || /<input[^>]*\btype=["']password["']/i.test(html)) return true;
  const location = response.headers.get('location');
  return Boolean(location && new URL(location, courierOrigins.steadfast).pathname === '/login');
}

async function steadfastPage(path: string, record: SteadfastSession | null | undefined, fetcher: CourierFetcher, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'text/html'); headers.set('User-Agent', userAgent); headers.set('Cache-Control', 'no-cache');
  if (record) headers.set('Cookie', steadfastCookieHeader(record));
  const response = await send(`${courierOrigins.steadfast}${path}`, { ...init, headers }, fetcher);
  const html = await courierText(response);
  return { response, html, record: mergeSteadfastCookies(record, response.headers.getSetCookie()) };
}

async function restoreSteadfast(record: SteadfastSession, fetcher: CourierFetcher) {
  const result = await steadfastPage(steadfastCheck, record, fetcher);
  if (steadfastNeedsLogin(result.response, result.html)) throw new CourierAuthError(401, 'Steadfast renewal was refused. Reconnect your merchant account.');
  if (!result.response.ok) throw upstreamFailure(result.response.status, 'Steadfast');
  if (!csrfFrom(result.html) || !/name=["'](?:phone|details|name)["']/i.test(result.html) || !sessionCookies.some(name => result.record.cookies[name])) {
    throw new CourierAuthError(502, 'Steadfast returned an unexpected account page. Try again later.');
  }
  return result.record;
}

export async function renewSteadfast(credentials: MerchantCredentials, cached?: SteadfastSession | null, fetcher: CourierFetcher = fetch): Promise<SteadfastSession> {
  if (cached) {
    const record = mergeSteadfastCookies(cached, []);
    if (Object.keys(record.cookies).some(name => name.startsWith('remember_web_'))) return restoreSteadfast(record, fetcher);
    throw new CourierAuthError(401, 'Steadfast remember-me login expired. Reconnect your merchant account.');
  }
  const page = await steadfastPage('/login', null, fetcher);
  if (!page.response.ok) throw upstreamFailure(page.response.status, 'Steadfast');
  const csrf = csrfFrom(page.html);
  if (!csrf) throw new CourierAuthError(502, 'Steadfast returned an unexpected login page. Try again later.');
  const posted = await steadfastPage('/login', page.record, fetcher, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: courierOrigins.steadfast, Referer: `${courierOrigins.steadfast}/login` },
    body: new URLSearchParams({ _token: csrf, email: credentials.username, password: credentials.password, remember: '1' }),
  });
  if (steadfastNeedsLogin(posted.response, posted.html) || [400, 422].includes(posted.response.status)) throw new CourierAuthError(401, 'Steadfast refused the email or password. Check your merchant login.');
  if (![302, 303].includes(posted.response.status)) throw upstreamFailure(posted.response.status, 'Steadfast');
  const location = new URL(posted.response.headers.get('location') ?? '/', courierOrigins.steadfast);
  if (location.origin !== courierOrigins.steadfast) throw new CourierAuthError(502, 'Steadfast returned an unexpected login redirect.');
  const record = await restoreSteadfast(posted.record, fetcher);
  if (!Object.keys(record.cookies).some(name => name.startsWith('remember_web_'))) throw new CourierAuthError(502, 'Steadfast did not issue a remember-me login. Try connecting again.');
  return record;
}

export function courierSessionIdentity(session: CourierSession) {
  return session.provider === 'pathao' ? session.accessToken : steadfastCookieHeader(session);
}

export function courierSessionFresh(session: CourierSession) { return session.expiresAt > Date.now() + 300000; }
