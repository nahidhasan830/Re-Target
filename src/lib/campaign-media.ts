import { env } from 'cloudflare:workers';
import type { Account } from './auth';
import { HttpError } from './http';
import { LIMITS } from './campaign-content';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export type CampaignAsset = {
  id: string;
  owner_id: string;
  original_name: string;
  original_key: string;
  prepared_key: string | null;
  kind: 'image' | 'video';
  mime: string;
  bytes: number;
  checksum: string;
  state: string;
  width: number | null;
  height: number | null;
  background: string;
  created_at: number;
};
export async function getAsset(ownerId: string, id: string) {
  const asset = await env.DB.prepare(
    'SELECT * FROM campaign_assets WHERE owner_id=? AND id=?',
  )
    .bind(ownerId, id)
    .first<CampaignAsset>();
  if (!asset) throw new HttpError(404, 'Attachment not found.');
  return asset;
}
const libraryQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(24).default(12),
  search: z.string().trim().max(120).default(''),
  kind: z.enum(['all', 'image', 'video']).default('all'),
});
export async function listAssets(ownerId: string, params: URLSearchParams) {
  const parsed = libraryQuery.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new HttpError(400, 'Choose valid media filters.');
  const { page, pageSize, search, kind } = parsed.data;
  const where = "a.owner_id=? AND a.state IN ('ready','preparing','invalid') AND (?='all' OR a.kind=?) AND instr(lower(a.original_name),lower(?))>0";
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM campaign_assets a WHERE ${where}`)
    .bind(ownerId, kind, kind, search).first<{ total: number }>();
  const total = count?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const rows = await env.DB.prepare(`SELECT a.id,a.original_name name,a.kind,a.mime,a.bytes,a.state,a.width,a.height,a.background,a.created_at,a.error,
    (EXISTS(SELECT 1 FROM campaign_parts p WHERE p.owner_id=a.owner_id AND p.asset_id=a.id) OR EXISTS(SELECT 1 FROM campaign_messages m WHERE m.owner_id=a.owner_id AND m.asset_id=a.id)) in_use
    FROM campaign_assets a WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`)
    .bind(ownerId, kind, kind, search, pageSize, (current - 1) * pageSize).all();
  return { items: rows.results, total, page: current, pages, pageSize };
}
export async function uploadAsset(account: Account, request: Request) {
  const mime = request.headers.get('content-type')?.split(';')[0] ?? '';
  if (!['image/jpeg', 'image/png', 'video/mp4'].includes(mime))
    throw new HttpError(415, 'Use JPEG, PNG, or MP4.');
  const kind = mime === 'video/mp4' ? 'video' : 'image';
  const length = Number(request.headers.get('content-length'));
  const limit = kind === 'image' ? LIMITS.image : LIMITS.video;
  if (!Number.isInteger(length) || length <= 0)
    throw new HttpError(411, 'Upload a file with a known size.');
  if (length > limit)
    throw new HttpError(
      413,
      `Use an ${kind === 'image' ? 'image up to 5 MB' : 'MP4 video up to 100 MB'}.`,
    );
  if (!request.body) throw new HttpError(400, 'Choose an attachment.');
  if (!env.MEDIA_PREPARATION_URL || !env.MEDIA_PREPARATION_KEY)
    throw new HttpError(
      503,
      'Media preparation is not configured. Ask the administrator to connect it.',
    );
  const endpoint = new URL('/prepare', env.MEDIA_PREPARATION_URL);
  if (
    endpoint.username || endpoint.password ||
    (endpoint.protocol !== 'https:' &&
    !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))
  )
    throw new HttpError(
      503,
      'Media preparation requires a protected HTTPS service.',
    );
  const background = request.headers.get('x-background') ?? '#ffffff';
  if (!/^#[0-9a-fA-F]{6}$/.test(background))
    throw new HttpError(400, 'Choose a valid image background.');
  let filename: string;
  try {
    filename = decodeURIComponent(
      request.headers.get('x-file-name') ?? 'attachment',
    );
  } catch {
    throw new HttpError(400, 'Invalid filename.');
  }
  filename =
    filename.replace(/[\x00-\x1f\x7f/\\]/g, '').slice(0, 200) || 'attachment';
  const id = crypto.randomUUID(),
    originalKey = `campaigns/${account.id}/${id}/original`,
    preparedKey = `campaigns/${account.id}/${id}/prepared.${kind === 'image' ? 'jpg' : 'mp4'}`;
  await env.DB.prepare(
    "INSERT INTO campaign_assets(id,owner_id,user_id,original_name,original_key,kind,mime,bytes,checksum,state,background,created_at) VALUES (?,?,?,?,?,?,?,?,?,'preparing',?,unixepoch())",
  )
    .bind(
      id,
      account.id,
      account.role === 'user' ? account.id : null,
      filename,
      originalKey,
      kind,
      mime,
      length,
      '',
      background,
    )
    .run();
  try {
    const fixed = new FixedLengthStream(length);
    let bytes = 0;
    const stream = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > limit || bytes > length)
            throw new HttpError(413, 'File exceeds its declared upload size.');
          controller.enqueue(chunk);
        },
      }),
    );
    const stored = await Promise.allSettled([
      stream.pipeTo(fixed.writable),
      env.MEDIA.put(originalKey, fixed.readable, {
        httpMetadata: { contentType: mime },
      }),
    ]);
    for (const result of stored)
      if (result.status === 'rejected') throw result.reason;
    const original = await env.MEDIA.get(originalKey);
    if (!original || original.size !== length)
      throw new HttpError(400, 'The upload was interrupted. Retry the file.');
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Content-Length': String(length),
      Authorization: `Bearer ${env.MEDIA_PREPARATION_KEY}`,
      'X-Background': background,
    };
    if (
      endpoint.protocol === 'https:' &&
      env.CF_ACCESS_CLIENT_ID &&
      env.CF_ACCESS_CLIENT_SECRET
    ) {
      headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
    }
    const prepared = await fetch(endpoint, {
      method: 'POST',
      body: original.body,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(120000),
    });
    const actualMime = prepared.headers.get('content-type'),
      outputSize = Number(prepared.headers.get('content-length'));
    const checksum = prepared.headers.get('x-media-checksum') ?? '',
      width = Number(prepared.headers.get('x-media-width')),
      height = Number(prepared.headers.get('x-media-height'));
    if (
      !prepared.ok ||
      actualMime !== (kind === 'image' ? 'image/jpeg' : 'video/mp4') ||
      !prepared.body ||
      !Number.isInteger(outputSize) ||
      outputSize <= 0 ||
      outputSize > limit ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      width <= 0 ||
      height <= 0 ||
      width > 4096 ||
      height > 4096
    ) {
      await prepared.body?.cancel();
      throw new HttpError(
        422,
        'The file could not be prepared. Use a valid still JPEG/PNG image or MP4 video.',
      );
    }
    const output = new FixedLengthStream(outputSize),
      hash = createHash('sha256');
    const preparedStream = prepared.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          hash.update(chunk);
          controller.enqueue(chunk);
        },
      }),
    );
    const saved = await Promise.allSettled([
      preparedStream.pipeTo(output.writable),
      env.MEDIA.put(preparedKey, output.readable, {
        httpMetadata: { contentType: actualMime },
      }),
    ]);
    for (const result of saved)
      if (result.status === 'rejected') throw result.reason;
    if (hash.digest('hex') !== checksum)
      throw new HttpError(
        422,
        'Prepared media checksum did not match. Retry the upload.',
      );
    const update = await env.DB.prepare(
      "UPDATE campaign_assets SET prepared_key=?,mime=?,bytes=?,checksum=?,width=?,height=?,state='ready',library_saved=1 WHERE owner_id=? AND id=? AND state='preparing'",
    )
      .bind(
        preparedKey,
        actualMime,
        outputSize,
        checksum,
        width,
        height,
        account.id,
        id,
      )
      .run();
    if (!update.meta.changes) {
      await env.MEDIA.delete([originalKey, preparedKey]);
      throw new HttpError(409, 'This upload is no longer available.');
    }
    return getAsset(account.id, id);
  } catch (error) {
    await env.DB.prepare(
      "UPDATE campaign_assets SET state='invalid',error='File preparation failed. Retry the upload.' WHERE owner_id=? AND id=?",
    )
      .bind(account.id, id)
      .run();
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      422,
      'File preparation failed. Retry with a valid image or MP4 video.',
    );
  }
}
export async function deleteAsset(ownerId: string, id: string) {
  const asset = await getAsset(ownerId, id);
  const result = await env.DB.prepare(
    `UPDATE campaign_assets SET state='deleting' WHERE owner_id=? AND id=? AND state!='preparing'
    AND NOT EXISTS(SELECT 1 FROM campaign_parts WHERE owner_id=? AND asset_id=?) AND NOT EXISTS(SELECT 1 FROM campaign_messages WHERE owner_id=? AND asset_id=?)`,
  )
    .bind(ownerId, id, ownerId, id, ownerId, id)
    .run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      'This attachment is preparing or still referenced by a campaign.',
    );
  await env.MEDIA.delete([
    asset.original_key,
    ...(asset.prepared_key ? [asset.prepared_key] : []),
  ]);
  await env.DB.prepare(
    "DELETE FROM campaign_assets WHERE owner_id=? AND id=? AND state='deleting'",
  )
    .bind(ownerId, id)
    .run();
  return { deleted: true };
}
export async function cleanupAssets() {
  await env.DB.prepare(
    "DELETE FROM campaigns WHERE id IN (SELECT id FROM campaigns WHERE status='archived' AND updated_at<unixepoch()-15552000 ORDER BY updated_at LIMIT 20)",
  ).run();
  const deleted = await env.DB.prepare(
    'SELECT id,original_key,prepared_key FROM campaign_media_cleanup LIMIT 20',
  ).all<{ id: string; original_key: string; prepared_key: string | null }>();
  for (const row of deleted.results) {
    await env.MEDIA.delete([
      row.original_key,
      ...(row.prepared_key ? [row.prepared_key] : []),
    ]);
    await env.DB.prepare('DELETE FROM campaign_media_cleanup WHERE id=?')
      .bind(row.id)
      .run();
  }

  const rows = await env.DB.prepare(
    `SELECT owner_id,id FROM campaign_assets WHERE created_at<unixepoch()-86400 AND (state IN ('invalid','deleting') OR (state='ready' AND library_saved=0))
    AND NOT EXISTS(SELECT 1 FROM campaign_parts p WHERE p.owner_id=campaign_assets.owner_id AND p.asset_id=campaign_assets.id)
    AND NOT EXISTS(SELECT 1 FROM campaign_messages m WHERE m.owner_id=campaign_assets.owner_id AND m.asset_id=campaign_assets.id) LIMIT 20`,
  ).all<{ owner_id: string; id: string }>();
  for (const row of rows.results)
    try {
      await deleteAsset(row.owner_id, row.id);
    } catch {
      /* Referenced or concurrently claimed uploads are retained. */
    }
  await env.DB.prepare(
    "UPDATE campaign_assets SET state='invalid',error='Upload interrupted. Retry the file.' WHERE state='preparing' AND created_at<unixepoch()-600",
  ).run();
}
const encoder = new TextEncoder();
async function signature(value: string) {
  const secret = env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret || secret.length < 32)
    throw new HttpError(503, 'Signed media access is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Buffer.from(
    await crypto.subtle.sign('HMAC', key, encoder.encode(value)),
  ).toString('hex');
}
export async function signedMediaUrl(
  ownerId: string,
  assetId: string,
  now = Math.floor(Date.now() / 1000),
) {
  const asset = await getAsset(ownerId, assetId);
  if (asset.state !== 'ready' || !asset.prepared_key)
    throw new HttpError(409, 'This attachment is unavailable.');
  const exists = await env.MEDIA.head(asset.prepared_key);
  if (!exists || exists.size !== asset.bytes)
    throw new HttpError(409, 'Prepared media is unavailable.');
  const payload = Buffer.from(
    JSON.stringify({ owner: ownerId, asset: assetId, expires: now + 600 }),
  ).toString('base64url');
  const token = `${payload}.${await signature(payload)}`;
  return {
    url: new URL(`/api/campaign-media/${token}`, env.CAMPAIGN_MEDIA_ORIGIN)
      .href,
    mime: asset.mime,
  };
}
export async function tokenAsset(token: string) {
  if (token.length > 1000)
    throw new HttpError(404, 'Media link is unavailable.');
  const [payload, mac, extra] = token.split('.');
  if (
    !payload ||
    !mac ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !/^[a-f0-9]{64}$/.test(mac) ||
    !timingSafeEqual(
      Buffer.from(mac, 'hex'),
      Buffer.from(await signature(payload), 'hex'),
    )
  )
    throw new HttpError(404, 'Media link is unavailable.');
  let data: { owner: string; asset: string; expires: number };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    throw new HttpError(404, 'Media link is unavailable.');
  }
  if (
    !data.owner ||
    !data.asset ||
    !Number.isInteger(data.expires) ||
    data.expires <= Date.now() / 1000
  )
    throw new HttpError(410, 'Media link expired.');
  return getAsset(data.owner, data.asset);
}
export async function serveAsset(asset: CampaignAsset, request: Request) {
  if (asset.state !== 'ready' || !asset.prepared_key)
    throw new HttpError(404, 'Prepared media is unavailable.');
  const head = await env.MEDIA.head(asset.prepared_key);
  if (!head) throw new HttpError(404, 'Prepared media is unavailable.');
  const headers = new Headers({
    'Content-Type': asset.mime,
    'Content-Disposition': 'inline',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  let offset = 0,
    length = head.size,
    status = 200;
  const range = request.headers.get('range');
  if (range) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parsed || (!parsed[1] && !parsed[2]))
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${head.size}` },
      });
    if (!parsed[1]) {
      length = Math.min(Number(parsed[2]), head.size);
      offset = head.size - length;
    } else {
      offset = Number(parsed[1]);
      const end = parsed[2]
        ? Math.min(Number(parsed[2]), head.size - 1)
        : head.size - 1;
      length = end - offset + 1;
    }
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      offset >= head.size
    )
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${head.size}` },
      });
    headers.set(
      'Content-Range',
      `bytes ${offset}-${offset + length - 1}/${head.size}`,
    );
    status = 206;
  }
  headers.set('Content-Length', String(length));
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const object = await env.MEDIA.get(asset.prepared_key, {
    range: { offset, length },
  });
  if (!object) throw new HttpError(404, 'Prepared media is unavailable.');
  return new Response(object.body, { status, headers });
}
