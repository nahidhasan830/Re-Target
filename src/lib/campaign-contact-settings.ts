import { env } from 'cloudflare:workers';
import { z } from 'zod';
import type { Account } from './auth';
import { digest } from './auth';
import { HttpError } from './http';
import { accountWhatsAppState, sessionName } from './whatsapp-connections';
import { checkWhatsAppNumber } from './waha';

export function suppressStatements(
  ownerId: string,
  leadId: string,
  reason: string,
) {
  return [
    env.DB.prepare(
      'UPDATE leads SET excluded=1 WHERE owner_id=? AND id=?',
    ).bind(ownerId, leadId),
    env.DB.prepare(
      `UPDATE campaign_messages SET status='skipped',error=? WHERE owner_id=? AND status='pending' AND recipient_id IN (SELECT id FROM campaign_recipients WHERE owner_id=? AND lead_id=?)`,
    ).bind(reason, ownerId, ownerId, leadId),
  ];
}
export async function testDestinations(account: Account) {
  if (
    account.role === 'admin' &&
    !(await env.DB.prepare(
      "SELECT owner_id FROM campaign_test_destinations WHERE owner_id='admin' LIMIT 1",
    ).first())
  ) {
    const numbers = (env.CAMPAIGN_TEST_NUMBERS ?? '')
      .split(',')
      .filter((phone) => /^01[3-9][0-9]{8}$/.test(phone))
      .slice(0, 10);
    if (numbers.length)
      await env.DB.batch(
        numbers.map((phone) =>
          env.DB.prepare(
            "INSERT INTO campaign_test_destinations(owner_id,phone,evidence_ref) VALUES ('admin',?,'Configured by project owner') ON CONFLICT DO NOTHING",
          ).bind(phone),
        ),
      );
  }
  return (
    await env.DB.prepare(
      'SELECT phone,checked_at checkedAt,evidence_ref evidenceRef FROM campaign_test_destinations WHERE owner_id=? ORDER BY phone',
    )
      .bind(account.id)
      .all()
  ).results;
}
export const testDestinationsInput = z
  .object({
    numbers: z
      .array(z.string().regex(/^01[3-9][0-9]{8}$/))
      .min(1)
      .max(10),
    evidence: z.string().trim().min(1).max(500).optional(),
    requestId: z.uuid(),
  })
  .strict();
export async function saveTestDestinations(
  account: Account,
  input: z.infer<typeof testDestinationsInput>,
) {
  const numbers = [...new Set(input.numbers)];
  const evidence = input.evidence ?? `Saved by ${account.phone}`;
  const state = await accountWhatsAppState(account);
  if (state.status !== 'WORKING')
    throw new HttpError(
      409,
      'Connect WhatsApp before verifying test destinations.',
    );
  const checked = [];
  for (const phone of numbers) {
    const result = await checkWhatsAppNumber(
      sessionName(account),
      `88${phone}`,
    );
    if (!result.exists)
      throw new HttpError(400, `${phone} has no verified WhatsApp account.`);
    checked.push({ phone, chatId: result.chatId! });
  }
  const hash = await digest(JSON.stringify(input));
  const previous = await env.DB.prepare(
    'SELECT input_hash FROM campaign_actions WHERE owner_id=? AND request_id=?',
  )
    .bind(account.id, input.requestId)
    .first<{ input_hash: string }>();
  if (previous) {
    if (previous.input_hash !== hash)
      throw new HttpError(409, 'This request ID was already used.');
    return testDestinations(account);
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO campaign_actions(id,owner_id,actor,action,request_id,input_hash,evidence_json,created_at) VALUES (?,?,?,'test_destinations',?,?,?,unixepoch())",
    ).bind(
      crypto.randomUUID(),
      account.id,
      account.phone,
      input.requestId,
      hash,
      JSON.stringify({ numbers, evidence }),
    ),
    env.DB.prepare(
      'DELETE FROM campaign_test_destinations WHERE owner_id=?',
    ).bind(account.id),
    ...checked.map((r) =>
      env.DB.prepare(
        'INSERT INTO campaign_test_destinations(owner_id,phone,chat_id,checked_at,evidence_ref) VALUES (?,?,?,unixepoch(),?)',
      ).bind(account.id, r.phone, r.chatId, evidence),
    ),
  ]);
  return testDestinations(account);
}
