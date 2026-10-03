export const restrictionReasons = {
  whatsapp_reachout_restricted:
    'WhatsApp temporarily restricted outreach (463). Sender paused; review before resuming.',
  whatsapp_message_cap:
    'WhatsApp reached its new-contact message limit (475). Sender paused; wait for the limit to reset.',
  whatsapp_cap_warning:
    'WhatsApp reported a message-limit warning. Sender paused; review before resuming.',
  gateway_rate_limit:
    'WhatsApp gateway rate limit (429). Sender paused; review before resuming.',
  gateway_unauthorized:
    'WhatsApp gateway authentication failed (401). Sender paused; check gateway access.',
  gateway_forbidden:
    'WhatsApp gateway denied sending (403). Sender paused; check gateway access and account restrictions.',
} as const;

export type WhatsAppRestriction = {
  reason: keyof typeof restrictionReasons;
  error: string;
};

function restriction(reason: WhatsAppRestriction['reason']): WhatsAppRestriction {
  return { reason, error: restrictionReasons[reason] };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function sessionRestriction(value: unknown): WhatsAppRestriction | null {
  const state = record(value);
  for (const source of [state, record(state.me), record(state.data)]) {
    if (record(source.reachoutTimelock).isActive === true)
      return restriction('whatsapp_reachout_restricted');
    const status = record(source.messageCapping).cappingStatus;
    if (status === 'CAPPED') return restriction('whatsapp_message_cap');
    if (typeof status === 'string' && status && status !== 'NONE')
      return restriction('whatsapp_cap_warning');
  }
  return null;
}

export function sendRestriction(status: number, body: unknown): WhatsAppRestriction | null {
  if (status === 401) return restriction('gateway_unauthorized');
  if (status === 403) return restriction('gateway_forbidden');
  if (status === 429) return restriction('gateway_rate_limit');
  // Inspect error fields only: WAHA also echoes request content in its error response.
  const inspect = (value: unknown, depth: number): WhatsAppRestriction | null => {
    if (depth > 4) return null;
    if (typeof value === 'string') {
      const code = /\bserver returned error\s*:?\s*(463|475)\b/i.exec(value)?.[1];
      return code === '463' ? restriction('whatsapp_reachout_restricted')
        : code === '475' ? restriction('whatsapp_message_cap') : null;
    }
    const error = record(value);
    for (const field of ['message', 'error', 'exception', 'cause']) {
      const result = inspect(error[field], depth + 1);
      if (result) return result;
    }
    return null;
  };
  return inspect(body, 0);
}
