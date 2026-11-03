import { z } from 'zod';
import { LIMITS, codePoints, validTokens } from './campaign-rules';

export * from './campaign-rules';

const day = z.iso.date();
export const campaignAudienceInput = z
  .object({
    mode: z.enum(['all', 'selected']).default('all'),
    ids: z.array(z.uuid()).max(50).default([]),
    search: z.string().trim().max(120).default(''),
    source: z.enum(['all', 'pathao', 'steadfast']).default('all'),
    whatsapp: z.enum(['all', 'yes', 'no', 'unknown']).default('yes'),
    eligibility: z.enum(['all', 'eligible', 'excluded']).default('all'),
    dates: z.enum(['all', 'known', 'unknown']).default('all'),
    from: day.optional(),
    to: day.optional(),
    minDeliveries: z.number().int().min(1).max(100000).optional(),
    minValue: z.number().min(0).max(21474836).optional(),
  })
  .strict()
  .refine(
    (q) => q.mode !== 'selected' || q.ids.length > 0,
    'Select at least one lead.',
  )
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    'Check the delivery dates.',
  )
  .refine(
    (q) => q.dates !== 'unknown' || (!q.from && !q.to),
    'Unknown dates cannot use a date range.',
  );
export const campaignContentInput = z
  .object({
    text: z
      .string()
      .refine(
        (t) => codePoints(t) <= LIMITS.text,
        'Message exceeds 4,000 characters.',
      ),
    assetIds: z.array(z.uuid()).max(LIMITS.attachments).default([]),
    separateText: z.boolean().default(false),
  })
  .strict()
  .refine(
    (c) => c.text.trim().length > 0 || c.assetIds.length > 0,
    'Add a message or attachment.',
  )
  .refine(
    (c) => new Set(c.assetIds).size === c.assetIds.length,
    'Each attachment can appear once.',
  )
  .refine(
    (c) => validTokens(c.text),
    'Use only {{name}} and {{company}} variables.',
  );
export const draftInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    content: campaignContentInput,
    audience: campaignAudienceInput,
    expiresAt: z.number().int().positive().nullable().default(null).transform(() => null),
    revision: z.number().int().positive().optional(),
  })
  .strict();
export type Audience = z.infer<typeof campaignAudienceInput>;
export type Content = z.infer<typeof campaignContentInput>;
export type DraftInput = z.infer<typeof draftInput>;
