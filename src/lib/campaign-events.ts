import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, readBody } from './http';
import { digest } from './auth';
import { pauseSender } from './campaign-delivery';
import { gatewayRequest, gatewayJson, whatsAppState } from './waha';
import { suppressStatements } from './campaign-contact-settings';
import { sessionRestriction } from './whatsapp-restrictions';

const eventInput = z.looseObject({
  id: z.string().max(200).optional(),
  event: z.enum(['message', 'message.ack', 'session.status']),
  session: z.string().min(1).max(100),
  timestamp: z.number().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export async function receiveWhatsAppEvent(request: Request) {
  const secret = env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret || secret.length < 32)
    throw new HttpError(503, 'Signed events are not configured.');
  const raw = await readBody(request, 64 * 1024),
    mac = request.headers.get('x-webhook-hmac');
  if (
    request.headers.get('x-webhook-hmac-algorithm') !== 'sha512' ||
    !mac ||
    !/^[a-f0-9]{128}$/i.test(mac)
  )
    throw new HttpError(401, 'Invalid webhook signature.');
  const encoder = new TextEncoder(),
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(raw)),
  );
  if (!timingSafeEqual(Buffer.from(mac, 'hex'), expected))
    throw new HttpError(401, 'Invalid webhook signature.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid event JSON.');
  }
  const parsed = eventInput.safeParse(value);
  if (!parsed.success)
    throw new HttpError(400, 'Unsupported or malformed event.');
  const event = parsed.data;
  const connection = await env.DB.prepare(
    'SELECT owner_id,phone FROM whatsapp_connections WHERE session_name=?',
  )
    .bind(event.session)
    .first<{ owner_id: string; phone: string | null }>();
  if (!connection) throw new HttpError(404, 'Unknown gateway session.');
  const id = event.id ?? (await digest(raw)),
    payload = event.payload,
    messageId = typeof payload.id === 'string' ? payload.id : null;
  const inserted = await env.DB.prepare(
    'INSERT INTO whatsapp_events(owner_id,id,session_name,event,message_id,payload_json,received_at) VALUES (?,?,?,?,?,?,unixepoch()) ON CONFLICT DO NOTHING',
  )
    .bind(
      connection.owner_id,
      id,
      event.session,
      event.event,
      messageId,
      JSON.stringify(payload),
    )
    .run();
  // Processing repeats after a crash until the persisted event is marked matched.
  if (!inserted.meta.changes) {
    const existing = await env.DB.prepare(
      'SELECT matched FROM whatsapp_events WHERE owner_id=? AND id=?',
    )
      .bind(connection.owner_id, id)
      .first<number>('matched');
    if (existing) return { accepted: true, duplicate: true };
  }
  await processEvent(connection.owner_id, id, event.event, payload);
  return { accepted: true };
}
async function processEvent(
  ownerId: string,
  id: string,
  type: string,
  payload: Record<string, unknown>,
) {
  if (type === 'session.status') {
    const connection = await env.DB.prepare('SELECT session_name,phone FROM whatsapp_connections WHERE owner_id=?')
      .bind(ownerId).first<{ session_name: string; phone: string | null }>();
    if (!connection) return;
    // Webhook retries can arrive after the session has already reconnected.
    const current = await whatsAppState(connection.session_name);
    const status = current.status;
    await env.DB.prepare(
      'UPDATE whatsapp_connections SET status=?,checked_at=unixepoch() WHERE owner_id=?',
    )
      .bind(status, ownerId)
      .run();
    const restriction = sessionRestriction(payload) ?? current.restriction;
    if (restriction) await pauseSender(ownerId, restriction.error);
    else if (status === 'WORKING' && current.phone !== connection.phone)
      await pauseSender(ownerId, 'Reconnect the original campaign sender.');
    else if (status !== 'WORKING')
      await pauseSender(
        ownerId,
        'WhatsApp disconnected. Reconnect it, then resume sending.',
      );
    await matched(ownerId, id);
    return;
  }
  if (type === 'message.ack') {
    if (
      typeof payload.id !== 'string' ||
      typeof payload.ack !== 'number' ||
      payload.fromMe !== true ||
      !Number.isInteger(payload.ack) ||
      payload.ack < 0 ||
      payload.ack > 4
    )
      return;
    const message = await env.DB.prepare(
      'SELECT id FROM campaign_messages WHERE owner_id=? AND gateway_id=?',
    )
      .bind(ownerId, payload.id)
      .first<{ id: string }>();
    if (!message) return;
    await env.DB.prepare(
      `UPDATE campaign_messages SET delivered_at=CASE WHEN ?>=2 THEN COALESCE(delivered_at,unixepoch()) ELSE delivered_at END,
      read_at=CASE WHEN ?>=3 THEN COALESCE(read_at,unixepoch()) ELSE read_at END WHERE owner_id=? AND id=?`,
    )
      .bind(payload.ack, payload.ack, ownerId, message.id)
      .run();
    await matched(ownerId, id);
    return;
  }
  if (
    type === 'message' &&
    payload.fromMe === false &&
    typeof payload.from === 'string' &&
    typeof payload.body === 'string'
  ) {
    const lead = await env.DB.prepare(
      'SELECT id FROM leads WHERE owner_id=? AND whatsapp_chat_id=? AND whatsapp_exists=1',
    )
      .bind(ownerId, payload.from)
      .first<{ id: string }>();
    if (!lead) return;
    const body = payload.body
      .trim()
      .replace(/[.!।]+$/, '')
      .toLocaleUpperCase();
    const quoted = quotedId(payload);
    const attributed = quoted
      ? await env.DB.prepare(
          'SELECT campaign_id FROM campaign_messages m JOIN campaign_recipients r ON r.owner_id=m.owner_id AND r.id=m.recipient_id WHERE m.owner_id=? AND m.gateway_id=? AND r.lead_id=?',
        )
          .bind(ownerId, quoted, lead.id)
          .first<string>('campaign_id')
      : null;
    const optOut = [
      'STOP',
      'UNSUBSCRIBE',
      'বন্ধ',
      'বন্ধ করুন',
      'আর মেসেজ দিবেন না',
      'মেসেজ বন্ধ করুন',
    ].includes(body);
    await env.DB.batch([
      ...(optOut
        ? suppressStatements(ownerId, lead.id, 'Do not contact')
        : [
            env.DB.prepare(
              "UPDATE campaign_messages SET status='skipped',error='Customer replied' WHERE owner_id=? AND status='pending' AND recipient_id IN (SELECT id FROM campaign_recipients WHERE owner_id=? AND lead_id=?)",
            ).bind(ownerId, ownerId, lead.id),
          ]),
      env.DB.prepare(
        "UPDATE campaign_recipients SET replied_at=unixepoch() WHERE owner_id=? AND lead_id=? AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=campaign_recipients.campaign_id AND c.status IN ('preparing','running','scheduled','paused'))",
      ).bind(ownerId, lead.id),
      env.DB.prepare(
        'INSERT INTO campaign_actions(id,owner_id,campaign_id,actor,action,request_id,input_hash,evidence_json,created_at) VALUES (?,?,?,?,?,?,?, ?,unixepoch()) ON CONFLICT(owner_id,request_id) DO NOTHING',
      ).bind(
        crypto.randomUUID(),
        ownerId,
        attributed,
        'whatsapp',
        optOut ? 'opt_out' : 'reply',
        `event:${id}`,
        await digest(JSON.stringify(payload)),
        JSON.stringify({
          leadId: lead.id,
          eventId: id,
          quotedMessageId: quotedId(payload),
        }),
      ),
    ]);
    await matched(ownerId, id);
  }
}
function quotedId(payload: Record<string, unknown>) {
  const reply = payload.replyTo;
  if (typeof reply === 'string') return reply;
  if (
    reply &&
    typeof reply === 'object' &&
    'id' in reply &&
    typeof reply.id === 'string'
  )
    return reply.id;
  return null;
}
async function matched(ownerId: string, id: string) {
  await env.DB.prepare(
    'UPDATE whatsapp_events SET matched=1 WHERE owner_id=? AND id=?',
  )
    .bind(ownerId, id)
    .run();
}
export async function reconcileMessageEvents(
  ownerId: string,
  gatewayId: string,
) {
  const events = await env.DB.prepare(
    'SELECT id,event,payload_json FROM whatsapp_events WHERE owner_id=? AND matched=0 AND message_id=? LIMIT 50',
  )
    .bind(ownerId, gatewayId)
    .all<{ id: string; event: string; payload_json: string }>();
  for (const event of events.results)
    await processEvent(
      ownerId,
      event.id,
      event.event,
      JSON.parse(event.payload_json),
    );
}
export async function recoverEvents() {
  const events = await env.DB.prepare(
    "SELECT owner_id,id,event,payload_json FROM whatsapp_events WHERE matched=0 AND event!='message.ack' ORDER BY received_at LIMIT 20",
  ).all<{
    owner_id: string;
    id: string;
    event: string;
    payload_json: string;
  }>();
  for (const event of events.results)
    await processEvent(
      event.owner_id,
      event.id,
      event.event,
      JSON.parse(event.payload_json),
    );
}
export async function configureCampaignWebhook(session: string) {
  const secret = env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret || secret.length < 32)
    throw new HttpError(
      503,
      'Configure the webhook signing secret before campaign tests.',
    );
  const response = await gatewayRequest(
    `/api/sessions/${encodeURIComponent(session)}`,
  );
  if (!response.ok)
    throw new HttpError(503, 'Could not read the sender configuration.');
  const current = (await gatewayJson(response)) as {
    config?: Record<string, unknown>;
  };
  const config = current.config ?? {},
    hooks = Array.isArray(config.webhooks) ? config.webhooks : [];
  const url = new URL('/api/whatsapp/events', env.CAMPAIGN_MEDIA_ORIGIN).href;
  const same = hooks.find((h) => h && typeof h === 'object' && h.url === url);
  if (
    same &&
    same.hmac?.key === secret &&
    ['message', 'message.ack', 'session.status'].every((e) =>
      same.events?.includes(e),
    )
  )
    return;
  const updated = await gatewayRequest(
    `/api/sessions/${encodeURIComponent(session)}`,
    'PUT',
    {
      name: session,
      config: {
        ...config,
        webhooks: [
          ...hooks.filter((h) => !h || typeof h !== 'object' || h.url !== url),
          {
            url,
            events: ['message', 'message.ack', 'session.status'],
            hmac: { key: secret },
            retries: { delaySeconds: 2, attempts: 15, policy: 'exponential' },
          },
        ],
      },
    },
  );
  if (!updated.ok) {
    await updated.body?.cancel();
    throw new HttpError(503, 'Could not configure signed campaign events.');
  }
  await updated.body?.cancel();
}
