import type { APIRoute } from 'astro';
import { asc, gt } from 'drizzle-orm';
import { getDb } from '../../../db';
import { products } from '../../../db/schema';
import { json, productId, productInput, readJson } from '../../../lib/http';

export const GET: APIRoute = async ({ url }) => {
  const rawLimit = url.searchParams.get('limit') ?? '20';
  const limit = Number(rawLimit);
  const cursor = url.searchParams.get('cursor');
  if (!/^\d+$/.test(rawLimit) || limit < 1 || limit > 100 || (cursor && !productId.safeParse(cursor).success)) {
    return json({ error: 'Use limit 1–100 and a valid UUID cursor.' }, 400);
  }
  const rows = await getDb().select().from(products)
    .where(cursor ? gt(products.id, cursor) : undefined)
    .orderBy(asc(products.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return json({ data, nextCursor: hasMore ? data.at(-1)!.id : null });
};

export const POST: APIRoute = async ({ request }) => {
  const parsed = productInput.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'Invalid product.', issues: parsed.error.issues }, 400);
  const [product] = await getDb().insert(products)
    .values({ id: crypto.randomUUID(), ...parsed.data }).returning();
  return json({ data: product }, 201);
};
