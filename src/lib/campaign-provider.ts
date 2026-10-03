import { gatewayRequest, gatewayJson } from './waha';
import { readBody } from './http';
import { sendRestriction, type WhatsAppRestriction } from './whatsapp-restrictions';
export type SendResult = {
  outcome: 'accepted' | 'rejected' | 'unconfirmed';
  messageId: string | null;
  error: string | null;
  retryAfter: number | null;
  pause: boolean;
  retryable: boolean;
  skipReason?: WhatsAppRestriction['reason'];
};
export async function sendCampaignPart(
  session: string,
  chatId: string,
  part: { kind: string; text: string; mediaUrl?: string; mime?: string },
): Promise<SendResult> {
  const payload =
    part.kind === 'text'
      ? { session, chatId, text: part.text, linkPreview: false }
      : {
          session,
          chatId,
          caption: part.text,
          file: {
            url: part.mediaUrl,
            mimetype: part.mime,
            filename: part.kind === 'image' ? 'offer.jpg' : 'offer.mp4',
          },
          ...(part.kind === 'video' ? { convert: false } : {}),
        };
  try {
    const response = await gatewayRequest(
      part.kind === 'text'
        ? '/api/sendText'
        : part.kind === 'image'
          ? '/api/sendImage'
          : '/api/sendVideo',
      'POST',
      payload,
      45000,
    );
    if (!response.ok) {
      let body: unknown;
      try { body = JSON.parse(await readBody(response, 64 * 1024)); }
      catch { /* Unknown failures retain their original ambiguity handling. */ }
      const restriction = sendRestriction(response.status, body);
      if (restriction) return {
        outcome: 'rejected', messageId: null, error: restriction.error,
        skipReason: restriction.reason,
        retryAfter: response.status === 429 ? retryDelay(response.headers.get('retry-after')) : null,
        pause: true, retryable: false,
      };
      const uncertain = response.status >= 500 || response.status === 408;
      return {
        outcome: uncertain ? 'unconfirmed' : 'rejected',
        messageId: null,
        error: uncertain
          ? 'The gateway outcome is unconfirmed. Check WhatsApp before resolving.'
          : 'The gateway rejected this part.',
        retryAfter: null,
        pause: uncertain,
        retryable: false,
      };
    }
    const data = (await gatewayJson(response)) as { id?: unknown };
    if (typeof data.id !== 'string' || !data.id || data.id.length > 200)
      throw new Error('Unconfirmed response');
    return {
      outcome: 'accepted',
      messageId: data.id,
      error: null,
      retryAfter: null,
      pause: false,
      retryable: false,
    };
  } catch {
    return {
      outcome: 'unconfirmed',
      messageId: null,
      error:
        'The gateway outcome is unconfirmed. Check WhatsApp before resolving.',
      retryAfter: null,
      pause: true,
      retryable: false,
    };
  }
}
function retryDelay(value: string | null) {
  if (!value) return 300;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(60, Math.min(86400, seconds))
    : Math.max(
        60,
        Math.min(
          86400,
          Math.ceil((Date.parse(value) - Date.now()) / 1000) || 300,
        ),
      );
}
