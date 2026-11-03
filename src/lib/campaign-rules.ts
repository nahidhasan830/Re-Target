import { restrictionReasons } from './whatsapp-restrictions';
import type { Content } from './campaign-content';

export const SEND_INTERVAL_SECONDS = 6;
export const DAILY_SEND_ATTEMPTS = 450;
export const LIMITS = {
  attachments: 3,
  text: 4000,
  caption: 1024,
  image: 5 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  json: 32 * 1024,
};
export const codePoints = (value: string) => Array.from(value).length;

export type Part = {
  ordinal: number;
  kind: 'text' | 'image' | 'video';
  text: string;
  assetId: string | null;
};
export type AssetDefinition = { id: string; kind: 'image' | 'video' };

export function validTokens(text: string) {
  return !text.replace(/\{\{(?:name|company)\}\}/g, '').match(/\{\{|\}\}/);
}
export function safePersonalization(
  value: string | null | undefined,
  fallback: string,
) {
  const clean = (value ?? '')
    .replace(/[\n\r\t*_~`<>\[\]{}\\\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean && codePoints(clean) <= 120 ? clean : fallback;
}
export function renderText(
  template: string,
  name: string | null,
  company: string,
) {
  if (!validTokens(template))
    throw new Error('Use only {{name}} and {{company}} variables.');
  const text = template
    .replaceAll('{{name}}', safePersonalization(name, 'বন্ধু'))
    .replaceAll(
      '{{company}}',
      safePersonalization(company, 'আমাদের প্রতিষ্ঠান'),
    );
  if (codePoints(text) > LIMITS.text)
    throw new Error(
      'A personalized message exceeds 4,000 characters. Shorten the message.',
    );
  return text;
}
export function compileParts(
  content: Content,
  assets: AssetDefinition[],
  name: string | null,
  company: string,
): Part[] {
  const text = renderText(content.text, name, company);
  const ordered = content.assetIds.map((id) => {
    const asset = assets.find((asset) => asset.id === id);
    if (!asset) throw new Error('An attachment is unavailable.');
    return asset;
  });
  const parts: Part[] = [];
  const captionCeiling = content.text
    .replaceAll('{{name}}', 'a'.repeat(120))
    .replaceAll('{{company}}', 'a'.repeat(120));
  const separate =
    !ordered.length ||
    content.separateText ||
    codePoints(captionCeiling) > LIMITS.caption;
  if (separate && text.trim())
    parts.push({ ordinal: 0, kind: 'text', text, assetId: null });
  ordered.forEach((asset, index) =>
    parts.push({
      ordinal: parts.length,
      kind: asset.kind,
      assetId: asset.id,
      text: !separate && index === 0 ? text : '',
    }),
  );
  return parts;
}
export function dhakaDate(now: number) {
  return new Date((now + 21600) * 1000).toISOString().slice(0, 10);
}
export function nextBudgetDay(now: number) {
  return Math.floor(Date.parse(`${dhakaDate(now)}T00:00:00+06:00`) / 1000) + 86400;
}
export const skipOrder = [
  'excluded',
  'no_whatsapp',
  'not_verified',
  'cooldown',
  'replied',
  'expired',
] as const;
export function skipReasons(
  lead: {
    excluded: number;
    whatsappExists: number | null;
    whatsappCheckedAt: number | null;
    chatId: string | null;
    nextAllowedAt: number | null;
  },
  now: number,
) {
  const reasons: string[] = [];
  if (lead.excluded) reasons.push('excluded');
  if (lead.whatsappExists === 0) reasons.push('no_whatsapp');
  else if (
    lead.whatsappExists !== 1 ||
    !lead.chatId ||
    !lead.whatsappCheckedAt ||
    lead.whatsappCheckedAt < now - 604800
  )
    reasons.push('not_verified');
  if ((lead.nextAllowedAt ?? 0) > now) reasons.push('cooldown');
  return reasons;
}
export const reasonLabels: Record<string, string> = {
  ...restrictionReasons,
  excluded: 'Do not contact',
  permission_revoked: 'Do not contact',
  permission_missing: 'Skipped under the previous consent requirement',
  no_whatsapp: 'No WhatsApp',
  not_verified: 'WhatsApp not verified',
  cooldown: 'Contacted in the last seven days',
  replied: 'Customer replied',
  expired: 'Offer expired',
};
