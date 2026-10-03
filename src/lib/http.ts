import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const productInput = z.object({
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(0).max(2147483647),
}).strict();

export const productId = z.uuid();

export async function readJson(request: Request, limit = 4096): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new HttpError(415, 'Expected application/json.');
  }
  const body = await readBody(request, limit);
  try { return JSON.parse(body); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

export async function readBody(request: Request | Response, limit = 4096): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, `Request body exceeds ${limit / 1024} KB.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}
