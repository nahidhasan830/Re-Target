import { env } from 'cloudflare:workers';
import { z } from 'zod';
import type { Account } from './auth';
import { digest } from './auth';
import { HttpError } from './http';
import {
  getCampaign,
  campaignAssets,
  detailCampaign,
  outboxStatement,
  dispatchOutbox,
} from './campaigns';
import { compileParts, type Content } from './campaign-content';
import { testDestinations } from './campaign-contact-settings';
import { accountWhatsAppState, sessionName } from './whatsapp-connections';
import { checkWhatsAppNumber } from './waha';
import { configureCampaignWebhook } from './campaign-events';
export const testSendInput = z
  .object({
    requestId: z.uuid(),
    revision: z.number().int().positive(),
    phone: z.string().regex(/^01[3-9][0-9]{8}$/).optional(),
    phones: z.array(z.string().regex(/^01[3-9][0-9]{8}$/)).min(1).max(10).optional(),
  })
  .strict()
  .refine((input) => (input.phone !== undefined) !== (input.phones !== undefined), { message: 'Choose one or more configured test receivers.' });
export async function createCampaignTest(
  account: Account,
  id: string,
  input: z.infer<typeof testSendInput>,
) {
  const hash = await digest(JSON.stringify({ id, ...input }));
  const prior = await env.DB.prepare(
    'SELECT input_hash,evidence_json FROM campaign_actions WHERE owner_id=? AND request_id=?',
  )
    .bind(account.id, input.requestId)
    .first<{ input_hash: string; evidence_json: string }>();
  if (prior) {
    if (prior.input_hash !== hash)
      throw new HttpError(409, 'This request ID was already used.');
    return detailCampaign(account.id, JSON.parse(prior.evidence_json).testId);
  }
  const campaign = await getCampaign(account.id, id);
  if (campaign.revision !== input.revision)
    throw new HttpError(
      409,
      'This campaign changed. Save and review it before testing.',
    );
  const phones = [...new Set(input.phones ?? [input.phone!])];
  const allowed = await testDestinations(account);
  if (phones.some((phone) => !allowed.some((r) => r.phone === phone)))
    throw new HttpError(
      403,
      'Choose this account’s configured test destinations.',
    );
  const state = await accountWhatsAppState(account);
  if (state.restriction) throw new HttpError(409, state.restriction.error);
  if (state.status !== 'WORKING' || !state.phone)
    throw new HttpError(409, 'Connect WhatsApp before sending a test.');
  const recipients = await Promise.all(phones.map(async (phone) => {
    const check = await checkWhatsAppNumber(sessionName(account), `88${phone}`);
    if (!check.exists || !check.chatId)
      throw new HttpError(400, `${phone} has no verified WhatsApp account.`);
    return { id: crypto.randomUUID(), phone, chatId: check.chatId };
  }));
  await configureCampaignWebhook(sessionName(account));
  const ready = await accountWhatsAppState(account);
  if (ready.restriction) throw new HttpError(409, ready.restriction.error);
  if (ready.status !== 'WORKING' || ready.phone !== state.phone)
    throw new HttpError(409, 'WhatsApp is reconnecting. Try sending the test again in a few seconds.');
  const content = JSON.parse(campaign.content_json) as Content,
    assets = await campaignAssets(account.id, content);
  const parts = compileParts(
    content,
    assets,
    'Test customer',
    campaign.company_name,
  );
  const testId = crypto.randomUUID(),
    now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO campaigns(id,owner_id,user_id,name,status,content_json,audience_json,company_name,sender_phone,is_test,created_at,updated_at,preparation_done,expires_at)
      SELECT ?,owner_id,user_id,?,'running',content_json,audience_json,company_name,?,1,?,?,1,? FROM campaigns WHERE owner_id=? AND id=? AND revision=?`,
    ).bind(
      testId,
      `Test: ${campaign.name}`,
      state.phone,
      now,
      now,
      now + 86400,
      account.id,
      id,
      input.revision,
    ),
    ...recipients.flatMap((recipient) => [
      env.DB.prepare(
        `INSERT INTO campaign_recipients(id,owner_id,campaign_id,phone,name,chat_id,evidence_json,prepared) SELECT ?,?,?,?,'Test customer',?,?,1 WHERE EXISTS(SELECT 1 FROM campaigns WHERE id=?)`,
      ).bind(
        recipient.id, account.id, testId, `88${recipient.phone}`, recipient.chatId,
        JSON.stringify({ explicitTest: true, parentCampaign: id }), testId,
      ),
      ...parts.map((part) => env.DB.prepare(
        'INSERT INTO campaign_messages(id,owner_id,campaign_id,recipient_id,ordinal,kind,text,asset_id,due_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE id=?)',
      ).bind(
        `${recipient.id}:${part.ordinal}`, account.id, testId, recipient.id,
        part.ordinal, part.kind, part.text, part.assetId, now, testId,
      )),
    ]),
    ...parts.map((part) =>
      env.DB.prepare(
        'INSERT INTO campaign_parts(owner_id,campaign_id,ordinal,kind,text,asset_id) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE id=?)',
      ).bind(
        account.id,
        testId,
        part.ordinal,
        part.kind,
        part.text,
        part.assetId,
        testId,
      ),
    ),
    env.DB.prepare(
      `INSERT INTO campaign_actions(id,owner_id,campaign_id,actor,action,request_id,input_hash,evidence_json,created_at) SELECT ?,?,?,?,'test',?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE id=?)`,
    ).bind(
      crypto.randomUUID(),
      account.id,
      id,
      account.phone,
      input.requestId,
      hash,
      JSON.stringify({ testId, destination: phones.join(', '), destinations: phones }),
      now,
      testId,
    ),
    ...recipients.map((recipient) => outboxStatement(account.id, testId, 'send', `${recipient.id}:0`, now)),
  ]);
  await dispatchOutbox();
  return detailCampaign(account.id, testId);
}
