import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb } from '../../../db';
import { products } from '../../../db/schema';
import { HttpError, json, productId, productInput, readJson } from '../../../lib/http';

function idFrom(value: string | undefined) {
  const parsed = productId.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Invalid product ID.');
  return parsed.data;
}

export const GET: APIRoute = async ({ params }) => {
  const [product] = await getDb().select().from(products).where(eq(products.id, idFrom(params.id))).limit(1);
  return product ? json({ data: product }) : json({ error: 'Product not found.' }, 404);
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = idFrom(params.id);
  const parsed = productInput.partial().refine((value) => Object.keys(value).length > 0)
    .safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'Invalid product update.', issues: parsed.error.issues }, 400);
  const [product] = await getDb().update(products).set(parsed.data).where(eq(products.id, id)).returning();
  return product ? json({ data: product }) : json({ error: 'Product not found.' }, 404);
};

export const DELETE: APIRoute = async ({ params }) => {
  const [product] = await getDb().delete(products).where(eq(products.id, idFrom(params.id))).returning({ id: products.id });
  return product ? new Response(null, { status: 204 }) : json({ error: 'Product not found.' }, 404);
};
