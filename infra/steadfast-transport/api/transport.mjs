import { compactSteadfast } from '../parser.mjs';
import { timingSafeEqual } from 'node:crypto';
const allowedHeaders = new Set(['cache-control','accept','accept-language','content-type','cookie','origin','referer','user-agent','x-xsrf-token','x-csrf-token']);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.STEADFAST_TRANSPORT_TOKEN;
  const expected = Buffer.from(`Bearer ${secret || ''}`), supplied = Buffer.from(String(req.headers.authorization || ''));
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let data, url;
  try {
    data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(data).length > 65536) throw new Error();
    url = new URL(data.url);
    if (url.origin !== 'https://steadfast.com.bd' || url.username || url.password || url.hash) throw new Error();
    const login = url.pathname === '/login' && !url.search;
    const protectedPage = (url.pathname === '/user/frauds/create' || /^\/user\/consignment\/\d+$/.test(url.pathname)) && !url.search;
    const list = url.pathname === '/user/consignment/status/delivered' && [...url.searchParams.keys()].every(key => key === 'cursor') && url.searchParams.getAll('cursor').length <= 1 && (!url.searchParams.has('cursor') || /^[A-Za-z0-9_=-]{1,2048}$/.test(url.searchParams.get('cursor')));
    if (!(data.method === 'POST' && login || data.method === 'GET' && (login || protectedPage || list))) throw new Error();
    if (data.body && (typeof data.body !== 'string' || data.method !== 'POST')) throw new Error();
    if (!data.headers || typeof data.headers !== 'object' || Array.isArray(data.headers)) throw new Error();
    for (const [key, value] of Object.entries(data.headers)) if (!allowedHeaders.has(key.toLowerCase()) || typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error();
  } catch { return res.status(400).json({ error: 'Invalid courier request' }); }
  try {
    const response = await fetch(url, { method: data.method, headers: data.headers, ...(data.body ? { body: data.body } : {}), redirect: 'manual', signal: AbortSignal.timeout(12000) });
    let size = 0; const chunks = [];
    if (response.body) for await (const chunk of response.body) { size += chunk.length; if (size > 1024 * 1024) throw new Error(); chunks.push(Buffer.from(chunk)); }
    const html = Buffer.concat(chunks).toString('utf8');
    const body = response.status === 200 && url.pathname.startsWith('/user/consignment/') && !/<input[^>]*type=["']password["']/i.test(html) ? compactSteadfast(html, url.pathname + url.search) : html;
    return res.status(200).json({ status: response.status, body, cookies: response.headers.getSetCookie(), type: response.headers.get('content-type'), location: response.headers.get('location') });
  } catch { return res.status(502).json({ error: 'Courier unavailable' }); }
}
