import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { fakeWaha } from './helpers/waha.mjs';

const dir = await mkdtemp(join(tmpdir(), 'retarget-campaign-tests-')),
  db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir('migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  db.exec(await readFile(`migrations/${file}`, 'utf8'));
const gateway = await fakeWaha('campaign-fixture-key');
let now = Date.parse('2026-10-02T11:00:00+06:00') / 1000,
  jobs = [];
const realNow = Date.now;
Date.now = () => now * 1000;
const binding = {
  prepare(sql) {
    let values = [];
    const statement = () =>
      db.prepare(sql.replaceAll('unixepoch()', String(now)));
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first(column) {
        const result = statement().get(...values);
        return column ? (result?.[column] ?? null) : (result ?? null);
      },
      execute() {
        return {
          results: statement().all(...values),
          meta: { changes: Number(db.prepare('SELECT changes() n').get().n) },
        };
      },
      async all() {
        return this.execute();
      },
      async run() {
        const result = statement().run(...values);
        return { meta: { changes: Number(result.changes) }, results: [] };
      },
    };
  },
  async batch(statements) {
    db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        results.push(statement.execute());
      }
      db.exec('COMMIT');
      return results;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
};
const objects = new Map();
globalThis.__campaignEnv = {
  DB: binding,
  CAMPAIGN_QUEUE: {
    async send(job) {
      jobs.push(job);
    },
  },
  LEAD_SYNC: { async send() {} },
  WAHA_BASE_URL: gateway.url,
  WAHA_API_KEY: 'campaign-fixture-key',
  ADMIN_PHONE: '01700000000',
  CAMPAIGN_TEST_NUMBERS: '01700000001,01700000002,01700000003',
  CAMPAIGN_MEDIA_ORIGIN: 'http://localhost:4321',
  WHATSAPP_WEBHOOK_SECRET: 'fixture-webhook-secret-at-least-32-characters',
  MEDIA: {
    async get(key, options) {
      const data = objects.get(key);
      if (!data) return null;
      const bytes = options?.range
        ? data.subarray(
            options.range.offset,
            options.range.offset + options.range.length,
          )
        : data;
      return { size: data.length, body: new Blob([bytes]).stream() };
    },
    async head(key) {
      const data = objects.get(key);
      return data ? { size: data.length } : null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        objects.delete(key);
    },
  },
};
await build({
  stdin: {
    contents:
      "export * from './src/lib/campaigns'; export * from './src/lib/campaign-content'; export * from './src/lib/campaign-audience'; export * from './src/lib/campaign-delivery'; export * from './src/lib/campaign-contact-settings'; export * from './src/lib/leads'; export * from './src/lib/campaign-media'; export * from './src/lib/campaign-events'; export * from './src/lib/campaign-tests'; export * from './src/lib/sender-reservation'; export * from './src/lib/campaign-sender';",
    resolveDir: process.cwd(),
    sourcefile: 'campaign-test-entry.ts',
  },
  outfile: join(dir, 'campaigns.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  plugins: [
    {
      name: 'test-env',
      setup(builder) {
        builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: 'env',
          namespace: 'test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const env=globalThis.__campaignEnv;',
        }));
        builder.onResolve(
          { filter: /^(zod|drizzle-orm|htmlparser2|domutils|domhandler)/ },
          (args) => ({
            path: import.meta.resolve(args.path).replace('file://', ''),
            external: true,
          }),
        );
      },
    },
  ],
});
const c = await import(pathToFileURL(join(dir, 'campaigns.mjs')));
const account = {
  id: 'admin',
  role: 'admin',
  phone: '01700000000',
  companyName: 'Test company',
  credentialVersion: 'test',
};
const sql = (command, ...args) => db.prepare(command).run(...args),
  one = (command, ...args) => db.prepare(command).get(...args),
  all = (command, ...args) => db.prepare(command).all(...args);
async function configure(extra = {}) {
  await fetch(`${gateway.url}/__test/state`, {
    method: 'POST',
    headers: { 'X-Api-Key': 'campaign-fixture-key' },
    body: JSON.stringify({
      session: { status: 'WORKING', me: { id: '8801700000000@c.us' } },
      numberCheckResponse: { numberExists: true, chatId: '8801712345678@c.us' },
      ...extra,
    }),
  });
}
const outgoing = async () =>
  await (
    await fetch(`${gateway.url}/__test/messages`, {
      headers: { 'X-Api-Key': 'campaign-fixture-key' },
    })
  ).json();
beforeEach(async () => {
  db.exec(
    'DELETE FROM campaign_actions; DELETE FROM campaign_outbox; DELETE FROM campaign_send_attempts; DELETE FROM campaign_messages; DELETE FROM campaign_parts; DELETE FROM campaign_recipients; DELETE FROM campaigns; DELETE FROM campaign_assets; DELETE FROM lead_contact_state; DELETE FROM lead_marketing_permissions; DELETE FROM shipments; DELETE FROM leads; DELETE FROM whatsapp_events; DELETE FROM sender_dispatch_state; DELETE FROM campaign_delivery_settings; DELETE FROM campaign_provider_verifications; DELETE FROM campaign_test_destinations; DELETE FROM whatsapp_connections; DELETE FROM users;',
  );
  now = Date.parse('2026-10-02T11:00:00+06:00') / 1000;
  jobs = [];
  objects.clear();
  await configure();
  sql(
    "INSERT INTO whatsapp_connections(owner_id,session_name,phone,status,checked_at) VALUES ('admin','admin','01700000000','WORKING',?)",
    now,
  );

});
after(async () => {
  Date.now = realNow;
  db.close();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
  delete globalThis.__campaignEnv;
});
function lead({
  owner = 'admin',
  id = randomUUID(),
  phone = `88017${String(Math.floor(Math.random() * 99999999)).padStart(8, '0')}`,
  excluded = 0,
  exists = 1,
  checked = now,
  sources = ['pathao', 'steadfast'],
  status = 'delivered',
  value = 10000,
} = {}) {
  sql(
    "INSERT INTO leads(id,owner_id,phone,name,excluded,whatsapp_exists,whatsapp_chat_id,whatsapp_checked_at,created_at) VALUES (?,?,?,'Amina',?,?,?,?,?)",
    id,
    owner,
    phone,
    excluded,
    exists,
    exists ? `${phone}@c.us` : null,
    checked,
    now,
  );
  for (const source of sources)
    sql(
      "INSERT INTO shipments(id,owner_id,lead_id,provider,shipment_id,raw_status,status,delivered_at,parcel_value_cents) VALUES (?,?,?,?,?,'fixture',?,?,?)",
      randomUUID(),
      owner,
      id,
      source,
      randomUUID(),
      status,
      now,
      value,
    );
  return id;
}
function asset(kind = 'image', owner = 'admin') {
  const id = randomUUID(),
    key = `campaigns/${owner}/${id}/prepared`;
  sql(
    "INSERT INTO campaign_assets(id,owner_id,original_name,original_key,prepared_key,kind,mime,bytes,checksum,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,'ready',?)",
    id,
    owner,
    'fixture',
    `${key}-original`,
    key,
    kind,
    kind === 'image' ? 'image/jpeg' : 'video/mp4',
    10,
    'a'.repeat(64),
    now,
  );
  objects.set(key, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  return id;
}
async function draft(
  content = {
    text: 'Hello {{name}} from {{company}}',
    assetIds: [],
    separateText: false,
  },
  audience = { mode: 'all', whatsapp: 'all' },
) {
  return c.createDraft(account, {
    name: 'Synthetic campaign',
    content,
    audience,
  });
}
async function launch(campaign, action = 'start', extra = {}) {
  return c.campaignAction(account, campaign.id, {
    action,
    revision: campaign.revision,
    requestId: randomUUID(),
    ...extra,
  });
}
async function prepared(content, audience) {
  const campaign = await draft(content, audience);
  await launch(campaign);
  await c.prepareCampaign('admin', campaign.id);
  return c.getCampaign('admin', campaign.id);
}
const messages = (id) =>
  all(
    'SELECT * FROM campaign_messages WHERE campaign_id=? ORDER BY recipient_id,ordinal',
    id,
  );
const tick = (seconds) => {
  now += seconds;
};

test('compiler preserves Bangla, Unicode limits, ordering, captions, fallbacks, and marker-safe personalization', () => {
  const image = { id: randomUUID(), kind: 'image' },
    video = { id: randomUUID(), kind: 'video' };
  const content = {
    text: 'হ্যালো {{name}} *অফার* {{company}} 🎉',
    assetIds: [image.id, video.id],
    separateText: false,
  };
  let parts = c.compileParts(content, [image, video], 'Amina *_\n~`', 'Test');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, 'হ্যালো Amina *অফার* Test 🎉');
  assert.equal(parts[1].text, '');
  parts = c.compileParts(
    { ...content, text: 'ক'.repeat(1025) },
    [image, video],
    null,
    'Test',
  );
  assert.deepEqual(
    parts.map((p) => p.kind),
    ['text', 'image', 'video'],
  );
  assert.equal(c.codePoints('🎉'), 1);
  assert.match(c.renderText('{{name}} {{company}}', null, 'Test'), /বন্ধু/);
  assert.throws(() => c.renderText('{{unknown}}', 'A', 'B'));
  assert.throws(() =>
    c.renderText('a'.repeat(3998) + '{{name}}', 'long name', 'B'),
  );
});
test('all matching selection spans every page, deduplicates couriers, and keeps unknown dates and amounts truthful', async () => {
  for (let i = 0; i < 65; i++)
    lead({ phone: `88017${String(i).padStart(8, '0')}` });
  const d = await draft();
  const p = await c.previewAudience('admin', d.audience);
  assert.equal(p.total, 65);
  assert.equal(p.ready, 65);
  assert.equal(p.sample.length, 25);
  assert.equal(p.pages, 3);
  const secondPage = await c.previewAudience('admin', d.audience, 2);
  assert.equal(secondPage.total, 65);
  assert.equal(secondPage.ready, 65);
  assert.equal(secondPage.sample.length, 25);
  assert.equal(new Set([...p.sample, ...secondPage.sample].map(row => row.id)).size, 50);
  const lastPage = await c.previewAudience('admin', d.audience, 9999);
  assert.equal(lastPage.page, 3);
  assert.equal(lastPage.sample.length, 15);
  assert.equal((await c.previewAudience('admin', d.audience, -1)).page, 1);
  const desktopBatch = await c.previewAudience('admin', d.audience, 1, 50);
  assert.equal(desktopBatch.sample.length, 50);
  assert.equal(desktopBatch.pages, 2);
  const remaining = await c.previewAudience('admin', d.audience, 2, 50);
  assert.equal(remaining.sample.length, 15);
  assert.equal(new Set([...desktopBatch.sample, ...remaining.sample].map(row => row.id)).size, 65);
  assert.equal((await c.previewAudience('admin', d.audience, 1, 1000)).sample.length, 50);
  assert.equal((await c.previewAudience('admin', d.audience, 1, NaN)).pageSize, 25);
  assert.equal(typeof desktopBatch.sample[0].deliveryCount, 'number');
  assert.equal(typeof desktopBatch.sample[0].totalParcelValue, 'number');
  assert.equal(desktopBatch.sample[0].whatsappExists, 1);
  await launch(d);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_recipients').n, 65);
  lead();
  assert.equal(one('SELECT COUNT(*) n FROM campaign_recipients').n, 65);
  const selected = await c.previewAudience(
    'admin',
    c.campaignAudienceInput.parse({
      minDeliveries: 2,
      minValue: 200,
      whatsapp: 'all',
    }),
  );
  assert.equal(selected.total, 66);
  const unknown = lead({ value: null });
  sql('UPDATE shipments SET delivered_at=NULL WHERE lead_id=?', unknown);
  assert.equal(
    (
      await c.previewAudience(
        'admin',
        c.campaignAudienceInput.parse({ dates: 'unknown', whatsapp: 'all' }),
      )
    ).total,
    1,
  );
});
test('mutually exclusive skip counts distinguish suppression, reachability, stale checks, and cooldown', async () => {
  lead();
  lead({ excluded: 1, exists: 0 });
  lead({ exists: 0 });
  lead({ exists: null, checked: null });
  const cooling = lead();
  sql(
    'INSERT INTO lead_contact_state VALUES (?,?,NULL,?,?)',
    'admin',
    cooling,
    now,
    now + 604800,
  );
  const p = await c.previewAudience(
    'admin',
    c.campaignAudienceInput.parse({ whatsapp: 'all' }),
  );
  assert.equal(p.total, 5);
  assert.equal(
    Object.values(p.breakdown).reduce((a, b) => a + b, 0),
    5,
  );
  for (const reason of [
    'ready',
    'excluded',
    'no_whatsapp',
    'not_verified',
    'cooldown',
  ])
    assert.equal(p.breakdown[reason], 1);
  assert.equal(p.noWhatsappCount, 2);
  assert.equal(p.incompleteChecks, 1);
});
test('empty and filtered previews keep counts accurate and never include another owner', async () => {
  const audience = c.campaignAudienceInput.parse({ whatsapp: 'all' });
  const empty = await c.previewAudience('admin', audience, 9999);
  assert.equal(empty.total, 0);
  assert.equal(empty.ready, 0);
  assert.equal(empty.page, 1);
  assert.equal(empty.pages, 1);
  assert.equal(empty.incompleteChecks, 0);
  assert.equal(empty.noWhatsappCount, 0);
  assert.deepEqual(empty.breakdown, {});
  assert.deepEqual(empty.sample, []);
  const ready = lead();
  lead({ exists: 0 });
  lead({ checked: now - 604801 });
  const selected = await c.previewAudience('admin', c.campaignAudienceInput.parse({ mode: 'selected', ids: [ready], whatsapp: 'all' }));
  assert.equal(selected.total, 1);
  assert.equal(selected.ready, 1);
  assert.deepEqual(selected.sample.map(row => row.id), [ready]);
  const all = await c.previewAudience('admin', audience);
  assert.equal(all.noWhatsappCount, 1);
  assert.equal(all.incompleteChecks, 1);
  const filtered = await c.previewAudience('admin', c.campaignAudienceInput.parse({ search: 'missing', whatsapp: 'all' }));
  assert.equal(filtered.total, 0);
  assert.deepEqual(filtered.sample, []);
  const other = await c.previewAudience('other', audience);
  assert.equal(other.total, 0);
  assert.deepEqual(other.sample, []);
});
test('owner-scoped assets and lead IDs block unavailable drafts or campaign access', async () => {
  const own = lead(),
    d = await draft();
  await assert.rejects(c.getCampaign(randomUUID(), d.id), /not found/);
  await assert.rejects(
    draft(
      { text: 'x', assetIds: [asset('image', 'other')] },
      { mode: 'selected', ids: [own] },
    ),
    /attachments/,
  );
  await assert.rejects(
    draft(undefined, { mode: 'selected', ids: [randomUUID()] }),
    /unavailable/,
  );
});
test('duplicate launches and optimistic draft writes preserve one fixed revision and one membership', async () => {
  lead();
  const d = await draft(),
    input = { action: 'start', revision: 1, requestId: randomUUID() };
  await c.campaignAction(account, d.id, input);
  await c.campaignAction(account, d.id, input);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_recipients').n, 1);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_actions').n, 1);
  await assert.rejects(
    c.editDraft(account, d.id, {
      name: 'changed',
      content: d.content,
      audience: d.audience,
      revision: 1,
    }),
    /changed/,
  );
});
test('preparation is bounded and failed preparation cannot publish a partial campaign', async () => {
  for (let i = 0; i < 30; i++)
    lead({ phone: `88018${String(i).padStart(8, '0')}` });
  const d = await draft();
  await launch(d);
  await c.prepareCampaign('admin', d.id);
  assert.equal((await c.getCampaign('admin', d.id)).status, 'preparing');
  assert.equal(
    one("SELECT COUNT(*) n FROM campaign_outbox WHERE kind='send'").n,
    0,
  );
  await c.prepareCampaign('admin', d.id);
  assert.equal((await c.getCampaign('admin', d.id)).status, 'running');
});
test('replayed queue jobs send each ordered part once, with a six-second gap between parts', async () => {
  lead();
  const d = await prepared({
      text: 'Hello',
      assetIds: [asset(), asset('video')],
      separateText: true,
    }),
    parts = messages(d.id);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 0);
  await c.processCampaignPart('admin', d.id, parts[0].id);
  await c.processCampaignPart('admin', d.id, parts[0].id);
  assert.equal((await outgoing()).length, 1);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(one('SELECT next_allowed_at FROM sender_dispatch_state').next_allowed_at, now + 6);
  tick(5);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 1);
  tick(1);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  tick(6);
  await c.processCampaignPart('admin', d.id, parts[2].id);
  assert.equal((await outgoing()).length, 3);
  assert.ok(messages(d.id).every((m) => m.status === 'sent'));
  assert.equal((await c.getCampaign('admin', d.id)).status, 'completed');
  assert.equal(one('SELECT consumed FROM sender_dispatch_state').consumed, 3);
  assert.equal(one('SELECT reserved FROM sender_dispatch_state').reserved, 0);
});
test('different customers wait six seconds between campaign messages', async () => {
  lead({ phone: '8801711111111' });
  lead({ phone: '8801722222222' });
  const d = await prepared(),
    parts = messages(d.id);
  assert.equal(parts.length, 2);
  await c.processCampaignPart('admin', d.id, parts[0].id);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 1);
  tick(5);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 1);
  tick(1);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 2);
});
test('the 450th daily attempt sends and the 451st waits until Dhaka midnight', async () => {
  lead({ phone: '8801711111111' });
  lead({ phone: '8801722222222' });
  const d = await prepared(),
    parts = messages(d.id);
  await c.ensureSender('admin', '01700000000');
  sql('UPDATE sender_dispatch_state SET consumed=449,budget_date=?', c.dhakaDate(now));
  await c.processCampaignPart('admin', d.id, parts[0].id);
  assert.equal(one('SELECT consumed FROM sender_dispatch_state').consumed, 450);
  assert.equal((await outgoing()).length, 1);
  tick(6);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(messages(d.id).find(part => part.id === parts[1].id).due_at, c.nextBudgetDay(now));
  now = c.nextBudgetDay(now);
  await c.processCampaignPart('admin', d.id, parts[1].id);
  assert.equal((await outgoing()).length, 2);
  assert.equal(one('SELECT consumed FROM sender_dispatch_state').consumed, 1);
});
test('two campaigns cannot claim the same lead or overlap a sender sequence', async () => {
  const id = lead(),
    d1 = await prepared({
      text: 'First',
      assetIds: [asset()],
      separateText: true,
    }),
    d2 = await prepared(
      { text: 'Second', assetIds: [], separateText: true },
      { mode: 'selected', ids: [id], whatsapp: 'all' },
    );
  await c.processCampaignPart('admin', d1.id, messages(d1.id)[0].id);
  tick(60);
  await c.processCampaignPart('admin', d2.id, messages(d2.id)[0].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(messages(d2.id)[0].status, 'skipped');
  await c.processCampaignPart('admin', d1.id, messages(d1.id)[1].id);
  assert.equal((await outgoing()).length, 2);
});
test('daily budget reserves an entire bundle, does not double-charge, and resets by Dhaka date', async () => {
  lead();
  const d = await prepared({
    text: 'hello',
    assetIds: [asset(), asset('video')],
    separateText: true,
  });
  await c.ensureSender('admin', '01700000000');
  sql(
    'UPDATE sender_dispatch_state SET consumed=448,budget_date=?',
    c.dhakaDate(now),
  );
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 0);
  assert.equal(one('SELECT consumed FROM sender_dispatch_state').consumed, 448);
  tick(86400);
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(one('SELECT consumed FROM sender_dispatch_state').consumed, 1);
  assert.equal(one('SELECT reserved FROM sender_dispatch_state').reserved, 2);
});
test('pause and cancel prevent unsent parts while preserving accepted history and consumed budget', async () => {
  lead();
  const d = await prepared({
    text: 'hello',
    assetIds: [asset()],
    separateText: true,
  });
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  await launch(d, 'pause');
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[1].id);
  assert.equal((await outgoing()).length, 1);
  await launch(d, 'cancel');
  assert.equal(messages(d.id)[0].status, 'sent');
  assert.equal(messages(d.id)[1].status, 'cancelled');
  assert.equal(one('SELECT reserved FROM sender_dispatch_state').reserved, 0);
  assert.equal(one('SELECT consumed FROM sender_dispatch_state').consumed, 1);
});
test('image success and video rejection produce partial results without resending the image', async () => {
  lead();
  await configure({ partStatuses: [200, 400] });
  const d = await prepared({
    text: 'hello',
    assetIds: [asset(), asset('video')],
    separateText: false,
  });
  for (const part of messages(d.id)) {
    await c.processCampaignPart('admin', d.id, part.id);
    tick(60);
  }
  assert.deepEqual(
    messages(d.id).map((m) => m.status),
    ['sent', 'failed'],
  );
  const detail = await c.detailCampaign('admin', d.id);
  assert.equal(detail.recipientCounts.partially_sent, 1);
  assert.equal(detail.messageCounts.sent, 1);
  await c.processCampaignPart('admin', d.id, messages(d.id)[1].id);
  assert.equal((await outgoing()).length, 2);
});
for (const [status, sendError, reason, wording] of [
  [500, { exception: { message: 'server returned error 463', stack: 'private stack' } }, 'whatsapp_reachout_restricted', 'restricted outreach'],
  [500, { exception: { cause: { message: 'server returned error: 475' } } }, 'whatsapp_message_cap', 'message limit'],
  [429, {}, 'gateway_rate_limit', 'rate limit'],
  [401, {}, 'gateway_unauthorized', 'authentication failed'],
  [403, {}, 'gateway_forbidden', 'denied sending'],
]) test(`restriction ${reason} skips the affected recipient, pauses the sender and never retries`, async () => {
  lead();
  lead();
  const campaign = await prepared({ text: 'Offer', assetIds: [asset()], separateText: true });
  const [part] = messages(campaign.id);
  await configure({ sendStatus: status, sendError });
  await c.processCampaignPart('admin', campaign.id, part.id);
  const affected = messages(campaign.id).filter(m => m.recipient_id === part.recipient_id);
  assert.deepEqual(affected.map(m => m.status), ['skipped', 'skipped']);
  for (const m of affected) {
    assert.match(m.error, new RegExp(wording));
    assert.doesNotMatch(m.error, /private|campaign-fixture-key/);
    assert.equal(m.gateway_id, null);
  }
  const recipient = one('SELECT * FROM campaign_recipients WHERE id=?', part.recipient_id);
  assert.equal(recipient.skip_reason, reason);
  assert.deepEqual(JSON.parse(recipient.reasons_json), [reason]);
  assert.equal(recipient.reserved, 0);
  const sender = one('SELECT * FROM sender_dispatch_state');
  assert.equal(sender.active_attempt, null);
  assert.equal(sender.active_recipient, null);
  assert.equal(sender.consumed, 1);
  assert.equal(sender.reserved, 0);
  assert.match(sender.pause_reason, new RegExp(wording));
  assert.equal(one('SELECT status FROM campaign_send_attempts').status, 'rejected');
  assert.equal((await c.getCampaign('admin', campaign.id)).status, 'paused');
  assert.equal((await c.detailCampaign('admin', campaign.id)).recipientCounts.skipped, 1);
  const others = messages(campaign.id).filter(m => m.recipient_id !== part.recipient_id);
  assert.ok(others.every(m => m.status === 'pending'));
  tick(300);
  await c.recoverCampaigns();
  for (const m of messages(campaign.id)) await c.processCampaignPart('admin', campaign.id, m.id);
  assert.equal((await outgoing()).length, 1);
});

test('restriction after an accepted attachment preserves the sent history and skips only remaining parts', async () => {
  lead();
  const campaign = await prepared({ text: 'Offer', assetIds: [asset(), asset('video')], separateText: false });
  await c.processCampaignPart('admin', campaign.id, messages(campaign.id)[0].id);
  const sentId = messages(campaign.id)[0].gateway_id;
  tick(60);
  await configure({ sendStatus: 500, sendError: { exception: { message: 'server returned error 475' } } });
  await c.processCampaignPart('admin', campaign.id, messages(campaign.id)[1].id);
  assert.deepEqual(messages(campaign.id).map(m => m.status), ['sent', 'skipped']);
  assert.equal(messages(campaign.id)[0].gateway_id, sentId);
  assert.match(messages(campaign.id)[1].error, /message limit/);
  assert.equal((await c.detailCampaign('admin', campaign.id)).recipientCounts.partially_sent, 1);
  assert.equal(one('SELECT skip_reason FROM campaign_recipients').skip_reason, null);
  assert.equal(one('SELECT reserved FROM sender_dispatch_state').reserved, 0);
  assert.equal((await c.getCampaign('admin', campaign.id)).status, 'paused');
});

for (const [signal, reason] of [
  [{ reachoutTimelock: { isActive: true } }, 'whatsapp_reachout_restricted'],
  [{ messageCapping: { cappingStatus: 'FIRST_WARNING' } }, 'whatsapp_cap_warning'],
  [{ messageCapping: { cappingStatus: 'SECOND_WARNING' } }, 'whatsapp_cap_warning'],
  [{ messageCapping: { cappingStatus: 'CAPPED' } }, 'whatsapp_message_cap'],
]) test(`connected sender with ${JSON.stringify(signal)} is stopped before a request`, async () => {
  lead();
  const campaign = await prepared();
  await configure({ session: { status: 'WORKING', me: { id: '8801700000000@c.us', ...signal } } });
  await c.processCampaignPart('admin', campaign.id, messages(campaign.id)[0].id);
  assert.equal((await outgoing()).length, 0);
  assert.equal(messages(campaign.id)[0].status, 'skipped');
  assert.equal(one('SELECT skip_reason FROM campaign_recipients').skip_reason, reason);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_send_attempts').n, 0);
  assert.equal(one('SELECT consumed FROM sender_dispatch_state').consumed, 0);
  assert.equal((await c.getCampaign('admin', campaign.id)).status, 'paused');
  await assert.rejects(launch(campaign, 'resume'), /Sender paused/);
  await assert.rejects(c.reviewSender(account, { requestId: randomUUID(), evidence: 'Review while restricted' }), /Sender paused/);
});

test('connected restriction webhook pauses all owner campaigns, blocks invitations and requires explicit resume', async () => {
  lead();
  const campaign = await prepared();
  const another = await prepared();
  await webhook({ id: 'restriction-warning', session: 'admin', event: 'session.status', payload: {
    status: 'WORKING', data: { messageCapping: { cappingStatus: 'SECOND_WARNING' } },
  } });
  assert.equal(one('SELECT status FROM whatsapp_connections').status, 'WORKING');
  assert.match(one('SELECT pause_reason FROM sender_dispatch_state').pause_reason, /message-limit warning/);
  for (const d of [campaign, another]) {
    assert.equal((await c.getCampaign('admin', d.id)).status, 'paused');
    await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  }
  await assert.rejects(c.reserveInvitationSender('new-invitation', '01700000000'), /paused/);
  await webhook({ id: 'restriction-cleared', session: 'admin', event: 'session.status', payload: {
    status: 'WORKING', data: { messageCapping: { cappingStatus: 'NONE' } },
  } });
  assert.equal((await c.getCampaign('admin', campaign.id)).status, 'paused');
  assert.ok(one('SELECT pause_reason FROM sender_dispatch_state').pause_reason);
  assert.equal((await outgoing()).length, 0);
});

test('restriction during preparation prevents publication and a new launch rejects a reported warning', async () => {
  lead();
  const campaign = await draft();
  await launch(campaign);
  await configure({ session: { status: 'WORKING', me: { id: '8801700000000@c.us', reachoutTimelock: { isActive: true } } } });
  await c.prepareCampaign('admin', campaign.id);
  assert.equal((await c.getCampaign('admin', campaign.id)).status, 'paused');
  assert.equal(messages(campaign.id).length, 0);
  const next = await draft();
  await assert.rejects(launch(next), /restricted outreach/);
  assert.equal((await outgoing()).length, 0);
});

test('a warning arriving after the send claim prevents an external request and preserves its explanation', async () => {
  lead();
  const campaign = await prepared();
  let warned = false;
  globalThis.__campaignEnv.DB = {
    ...binding,
    async batch(statements) {
      const result = await binding.batch(statements);
      if (!warned && one('SELECT COUNT(*) n FROM campaign_messages WHERE status=\'submitting\'').n) {
        warned = true;
        await webhook({ id: 'claimed-warning', session: 'admin', event: 'session.status', payload: {
          status: 'WORKING', data: { reachoutTimelock: { isActive: true } },
        } });
      }
      return result;
    },
  };
  try { await c.processCampaignPart('admin', campaign.id, messages(campaign.id)[0].id); }
  finally { globalThis.__campaignEnv.DB = binding; }
  assert.equal(warned, true);
  assert.equal((await outgoing()).length, 0);
  assert.equal(messages(campaign.id)[0].status, 'skipped');
  assert.match(messages(campaign.id)[0].error, /restricted outreach/);
  assert.equal(one('SELECT active_attempt FROM sender_dispatch_state').active_attempt, null);
  assert.equal(one('SELECT skip_reason FROM campaign_recipients WHERE campaign_id=?', campaign.id).skip_reason, 'whatsapp_reachout_restricted');
  assert.equal((await c.listRecipients('admin', campaign.id, new URL('https://example.test/?state=skipped'))).total, 1);
});

for (const sendError of [
  { exception: { message: 'socket disconnected' }, request: { body: { text: 'server returned error 463' } } },
  { exception: { message: 'server returned error 4630' } },
  { exception: { message: 'a'.repeat(65536) + 'server returned error 463' } },
]) test('unknown or oversized errors and echoed offer text remain unconfirmed rather than skipped', async () => {
  lead();
  const campaign = await prepared();
  await configure({ sendStatus: 500, sendError });
  await c.processCampaignPart('admin', campaign.id, messages(campaign.id)[0].id);
  assert.equal(messages(campaign.id)[0].status, 'unconfirmed');
  assert.ok(one('SELECT active_attempt FROM sender_dispatch_state').active_attempt);
  assert.doesNotMatch(messages(campaign.id)[0].error, /463|socket|campaign-fixture-key/);
});

for (const mode of ['5xx', 'malformed', 'expired_lease'])
  test(`${mode} becomes unconfirmed and holds the sender without automatic retry`, async () => {
    lead();
    const d = await prepared();
    const part = messages(d.id)[0];
    if (mode === 'expired_lease') {
      await c.ensureSender('admin', '01700000000');
      sql(
        "UPDATE campaign_messages SET status='submitting',lease_token='stale',lease_until=? WHERE id=?",
        now - 1,
        part.id,
      );
      sql(
        "INSERT INTO campaign_send_attempts(id,owner_id,message_id,status,submitted_at) VALUES ('stale','admin',?,'submitting',?)",
        part.id,
        now - 180,
      );
      sql(
        "UPDATE sender_dispatch_state SET active_attempt='stale',lease_until=?",
        now - 1,
      );
      await c.recoverCampaigns();
    } else {
      await configure(
        mode === '5xx' ? { sendStatus: 503 } : { malformedSend: true },
      );
      await c.processCampaignPart('admin', d.id, part.id);
    }
    assert.equal(messages(d.id)[0].status, 'unconfirmed');
    assert.ok(
      one('SELECT active_attempt FROM sender_dispatch_state').active_attempt,
    );
    assert.equal((await c.getCampaign('admin', d.id)).status, 'paused');
    const count = (await outgoing()).length;
    await c.recoverCampaigns();
    await c.processCampaignPart('admin', d.id, part.id);
    assert.equal((await outgoing()).length, count);
  });
test('an explicit unconfirmed resolution records evidence and requires acknowledgement for deliberate duplicate risk', async () => {
  lead();
  const d = await prepared();
  await configure({ sendStatus: 503 });
  const part = messages(d.id)[0];
  await c.processCampaignPart('admin', d.id, part.id);
  const input = {
    action: 'resolve',
    revision: 1,
    requestId: randomUUID(),
    messageId: part.id,
    resolution: 'unsent',
    evidence: 'Checked isolated fixture',
  };
  await assert.rejects(c.campaignAction(account, d.id, input), /Acknowledge/);
  await c.campaignAction(account, d.id, {
    ...input,
    acknowledgeDuplicateRisk: true,
  });
  assert.equal(messages(d.id)[0].status, 'pending');
  assert.equal(
    one('SELECT status FROM campaign_send_attempts').status,
    'resolved_unsent',
  );
  assert.equal(
    one('SELECT active_attempt FROM sender_dispatch_state').active_attempt,
    null,
  );
});
test('instant sending continues outside business hours and exclusions still block later parts', async () => {
  now = Date.parse('2026-10-02T22:00:00+06:00') / 1000;
  const leadId = lead(), d = await prepared({ text: 'hello', assetIds: [asset(), asset('video')], separateText: true });
  assert.equal(messages(d.id)[0].due_at, now);
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[1].id);
  assert.equal((await outgoing()).length, 2);
  sql('UPDATE leads SET excluded=1 WHERE id=?', leadId);
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[2].id);
  assert.equal((await outgoing()).length, 2);
});
test('scheduled delivery uses the chosen late-night time and never starts early', async () => {
  now = Date.parse('2026-10-02T22:00:00+06:00') / 1000;
  lead();
  const d = await draft(), due = now + 180;
  await launch(d, 'schedule', { scheduledAt: due });
  await c.prepareCampaign('admin', d.id);
  assert.equal(messages(d.id)[0].due_at, due);
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 0);
  tick(180);
  await c.recoverCampaigns();
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
});
test('legacy offer cutoffs cannot silently stop sending and new drafts discard them', async () => {
  lead();
  const d = await c.createDraft(account, { name: 'No cutoff', content: { text: 'Hello', assetIds: [] }, audience: { mode: 'all' }, expiresAt: now - 60 });
  assert.equal(d.expires_at, null);
  await launch(d);
  await c.prepareCampaign('admin', d.id);
  sql('UPDATE campaigns SET expires_at=? WHERE id=?', now - 60, d.id);
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
});
test('daily budget resumes at the next Dhaka midnight without a business-hour window', async () => {
  now = Date.parse('2026-10-02T23:59:00+06:00') / 1000;
  lead();
  const d = await prepared();
  await c.ensureSender('admin', '01700000000');
  sql('UPDATE sender_dispatch_state SET consumed=450,budget_date=?', c.dhakaDate(now));
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal(messages(d.id)[0].due_at, c.nextBudgetDay(now));
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
});

test('regular campaigns launch and dispatch without a test, verification or sending setting', async () => {
  lead();
  const d = await prepared();
  assert.equal(one('SELECT COUNT(*) n FROM campaigns WHERE is_test=1').n, 0);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_provider_verifications').n, 0);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_delivery_settings').n, 0);
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(messages(d.id)[0].status, 'sent');
});
test('legacy disabled sending settings do not block launching, scheduling or resuming', async () => {
  lead();
  sql("INSERT INTO campaign_delivery_settings(owner_id,sender_phone,enabled,updated_at,actor) VALUES ('admin','01700000000',0,?,'test')", now);
  const d = await prepared({ text: 'Hello', assetIds: [asset()], separateText: true });
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  await launch(await c.getCampaign('admin', d.id), 'pause');
  await launch(await c.getCampaign('admin', d.id), 'resume');
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[1].id);
  assert.equal((await outgoing()).length, 2);
  const scheduled = await draft();
  await c.campaignAction(account, scheduled.id, { action: 'schedule', revision: 1, requestId: randomUUID(), scheduledAt: now + 3600 });
  assert.equal((await c.getCampaign('admin', scheduled.id)).status, 'preparing');
});
test('an invited business can launch with its connected sender without test setup', async () => {
  const owner = randomUUID();
  sql("INSERT INTO users(id,phone,company_name,password_hash,created_at) VALUES (?,'01812345678','Fixture','synthetic',?)", owner, now);
  const business = { ...account, id: owner, role: 'user', phone: '01812345678' };
  sql("INSERT INTO whatsapp_connections(owner_id,user_id,session_name,phone,status,checked_at) VALUES (?,?,?,'01812345678','WORKING',?)", owner, owner, c.sessionFor(owner), now);
  await configure({ sessions: { [c.sessionFor(owner)]: { status: 'WORKING', me: { id: '8801812345678@c.us' } } } });
  lead({ owner });
  const d = await c.createDraft(business, { name: 'Business offer', content: { text: 'Hello', assetIds: [], separateText: false }, audience: { mode: 'all' } });
  await c.campaignAction(business, d.id, { action: 'start', revision: 1, requestId: randomUUID() });
  assert.equal((await c.getCampaign(owner, d.id)).sender_phone, '01812345678');
  assert.equal(one('SELECT COUNT(*) n FROM campaign_test_destinations WHERE owner_id=?', owner).n, 0);
  await assert.rejects(c.getCampaign('admin', d.id), /not found/);
});
test('a newly linked sender can launch without repeating test verification', async () => {
  lead();
  await configure({ session: { status: 'WORKING', me: { id: '8801812345678@c.us' } } });
  const d = await prepared();
  assert.equal(d.sender_phone, '01812345678');
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
});
async function webhook(event, forge = false) {
  const raw = JSON.stringify(event),
    mac = createHmac('sha512', globalThis.__campaignEnv.WHATSAPP_WEBHOOK_SECRET)
      .update(raw)
      .digest('hex');
  return c.receiveWhatsAppEvent(
    new Request('http://localhost/api/whatsapp/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Hmac': forge ? '0'.repeat(128) : mac,
        'X-Webhook-Hmac-Algorithm': 'sha512',
      },
      body: raw,
    }),
  );
}
test('delayed disconnect notifications use the current sender and do not pause a reconnected campaign', async () => {
  lead();
  const d = await prepared();
  for (const status of ['STARTING', 'FAILED']) {
    await webhook({ id: `late-${status}`, session: 'admin', event: 'session.status', payload: { status } });
  }
  assert.equal((await c.getCampaign('admin', d.id)).status, 'running');
  assert.equal(one('SELECT status FROM whatsapp_connections').status, 'WORKING');
  assert.equal(one('SELECT pause_reason FROM sender_dispatch_state')?.pause_reason ?? null, null);
  assert.equal((await outgoing()).length, 0);
});
test('a live disconnect pauses sending and reconnecting still requires explicit resume', async () => {
  lead();
  const d = await prepared();
  await configure({ session: { status: 'FAILED', me: null } });
  await webhook({ id: 'disconnected', session: 'admin', event: 'session.status', payload: { status: 'FAILED' } });
  assert.equal((await c.getCampaign('admin', d.id)).status, 'paused');
  await configure();
  await webhook({ id: 'connected-again', session: 'admin', event: 'session.status', payload: { status: 'WORKING' } });
  assert.equal((await c.getCampaign('admin', d.id)).status, 'paused');
  assert.equal((await outgoing()).length, 0);
});
test('resume immediately queues pending first parts without requeueing accepted messages', async () => {
  lead();
  const d = await prepared({ text: 'hello', assetIds: [asset()], separateText: true });
  const parts = messages(d.id);
  await c.processCampaignPart('admin', d.id, parts[0].id);
  await launch(d, 'pause');
  sql('DELETE FROM campaign_outbox');
  jobs = [];
  await launch(d, 'resume');
  assert.ok(jobs.some(job => job.workId === parts[1].id && job.task === 'send'));
  assert.ok(!jobs.some(job => job.workId === parts[0].id));
  assert.equal((await outgoing()).length, 1);
});
test('a webhook configuration restart cannot publish a test with a stale ready sender', async () => {
  const d = await draft();
  await configure({ sessionUpdateState: { status: 'STARTING', me: null } });
  await assert.rejects(c.createCampaignTest(account, d.id, { requestId: randomUUID(), revision: d.revision, phones: ['01700000003'] }), /reconnecting/);
  assert.equal(one('SELECT COUNT(*) n FROM campaigns WHERE is_test=1').n, 0);
  assert.equal((await outgoing()).length, 0);
});
test('signed events reject forgery and unknown sessions and deduplicate opt-outs between parts', async () => {
  const id = lead({ phone: '8801712345678' }),
    d = await prepared({
      text: 'hello',
      assetIds: [asset()],
      separateText: true,
    });
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  const event = {
    id: 'incoming-stop',
    session: 'admin',
    event: 'message',
    payload: {
      id: 'reply',
      fromMe: false,
      from: '8801712345678@c.us',
      body: 'STOP',
    },
  };
  await assert.rejects(webhook(event, true), /signature/);
  await assert.rejects(webhook({ ...event, session: 'other' }), /Unknown/);
  await webhook(event);
  await webhook(event);
  assert.equal(one('SELECT excluded FROM leads WHERE id=?', id).excluded, 1);
  assert.equal(one('SELECT COUNT(*) n FROM lead_marketing_permissions').n, 0);
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[1].id);
  assert.equal((await outgoing()).length, 1);
  await c.setExclusions('admin', { ids: [id], excluded: false });
  const preview = await c.previewAudience('admin', c.campaignAudienceInput.parse({ whatsapp: 'all' }));
  assert.equal(preview.breakdown.excluded, undefined);
  assert.equal(preview.breakdown.cooldown, 1);
});
test('early and out-of-order acknowledgements match later and never regress delivery or read state', async () => {
  lead();
  const d = await prepared();
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  const part = messages(d.id)[0],
    id = part.gateway_id;
  sql('UPDATE campaign_messages SET gateway_id=NULL WHERE id=?', part.id);
  await webhook({
    id: 'early',
    session: 'admin',
    event: 'message.ack',
    payload: { id, fromMe: true, ack: 3 },
  });
  assert.equal(
    one("SELECT matched FROM whatsapp_events WHERE id='early'").matched,
    0,
  );
  sql('UPDATE campaign_messages SET gateway_id=? WHERE id=?', id, part.id);
  await c.reconcileMessageEvents('admin', id);
  assert.ok(messages(d.id)[0].read_at);
  await webhook({
    id: 'late',
    session: 'admin',
    event: 'message.ack',
    payload: { id, fromMe: true, ack: 1 },
  });
  assert.ok(messages(d.id)[0].read_at);
  assert.ok(messages(d.id)[0].delivered_at);
});
test('ordinary replies stop remaining promotional parts without marking Do not contact', async () => {
  lead({ phone: '8801712345678' });
  const d = await prepared({
    text: 'hello',
    assetIds: [asset()],
    separateText: true,
  });
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  await webhook({
    id: 'ordinary',
    event: 'message',
    session: 'admin',
    payload: {
      id: 'response',
      fromMe: false,
      from: '8801712345678@c.us',
      body: 'What is the price?',
    },
  });
  assert.equal(messages(d.id)[1].status, 'skipped');
  assert.equal(one('SELECT COUNT(*) n FROM lead_marketing_permissions').n, 0);
  assert.equal(one('SELECT excluded FROM leads').excluded, 0);
});
test('private signed media supports repeated GET, HEAD, range requests, expiry and owner protection', async () => {
  const id = asset(),
    signed = await c.signedMediaUrl('admin', id),
    token = new URL(signed.url).pathname.split('/').at(-1),
    metadata = await c.tokenAsset(token);
  for (let i = 0; i < 2; i++) {
    const response = await c.serveAsset(metadata, new Request(signed.url));
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, 10);
  }
  const range = await c.serveAsset(
    metadata,
    new Request(signed.url, { headers: { Range: 'bytes=2-5' } }),
  );
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal((await range.arrayBuffer()).byteLength, 4);
  const head = await c.serveAsset(
    metadata,
    new Request(signed.url, { method: 'HEAD' }),
  );
  assert.equal(head.body, null);
  await assert.rejects(c.getAsset('other', id), /not found/);
  const d = await draft({ text: 'hello', assetIds: [id], separateText: false });
  await assert.rejects(c.deleteAsset('admin', id), /referenced/);
  tick(601);
  await assert.rejects(c.tokenAsset(token), /expired/);
  assert.ok(d.id);
});
test('accounts can save ten test destinations and reject an eleventh', async () => {
  const numbers = Array.from({ length: 10 }, (_, i) => `017000000${String(i).padStart(2, '0')}`);
  const input = { numbers, requestId: randomUUID() };
  const parsed = c.testDestinationsInput.parse(input);
  const saved = await c.saveTestDestinations(account, parsed);
  assert.deepEqual(saved.map((item) => item.phone), numbers);
  assert.ok(saved.every((item) => item.evidenceRef === `Saved by ${account.phone}`));
  assert.deepEqual((await c.testDestinations(account)).map((item) => item.phone), numbers);
  assert.equal(c.testDestinationsInput.safeParse({ ...input, numbers: [...numbers, '01800000000'] }).success, false);
  assert.equal(c.testDestinationsInput.safeParse({ ...input, numbers: [] }).success, false);
  assert.equal((await c.testDestinations({ ...account, id: randomUUID(), role: 'user' })).length, 0);
});
test('test destinations belong to the account, exact tests freeze compiled content, and emergency pause includes tests', async () => {
  const d = await draft({
    text: 'hello',
    assetIds: [asset()],
    separateText: true,
  });
  await assert.rejects(
    c.createCampaignTest(account, d.id, {
      requestId: randomUUID(),
      revision: 1,
      phone: '01999999999',
    }),
    /configured/,
  );
  const input = { requestId: randomUUID(), revision: 1, phone: '01700000001' };
  const result = await c.createCampaignTest(account, d.id, input);
  const replay = await c.createCampaignTest(account, d.id, input);
  assert.equal(result.id, replay.id);
  assert.deepEqual(
    messages(result.id).map((m) => m.kind),
    ['text', 'image'],
  );
  assert.equal(
    one("SELECT COUNT(*) n FROM campaign_actions WHERE action='test'").n,
    1,
  );
  await c.pauseSender('admin', 'restriction');
  assert.equal((await c.getCampaign('admin', result.id)).status, 'paused');
});
test('multi-receiver tests queue each exact bundle once and reject unconfigured receivers before creating a test', async () => {
  const d = await draft({ text: 'hello {{name}}', assetIds: [asset()], separateText: true });
  const phones = ['01700000001', '01700000002'];
  const input = c.testSendInput.parse({ requestId: randomUUID(), revision: 1, phones: [...phones, phones[0]] });
  const result = await c.createCampaignTest(account, d.id, input);
  assert.equal((await c.createCampaignTest(account, d.id, input)).id, result.id);
  const recipients = db.prepare('SELECT id,phone FROM campaign_recipients WHERE campaign_id=? ORDER BY phone').all(result.id);
  assert.deepEqual(recipients.map((r) => r.phone), phones.map((p) => `88${p}`).sort());
  for (const recipient of recipients) {
    assert.deepEqual(messages(result.id).filter((m) => m.recipient_id === recipient.id).map((m) => m.kind), ['text', 'image']);
    assert.equal(one('SELECT COUNT(*) n FROM campaign_outbox WHERE work_id=?', `${recipient.id}:0`).n, 1);
    assert.ok(jobs.some((job) => job.workId === `${recipient.id}:0`));
  }
  assert.equal(one("SELECT COUNT(*) n FROM campaign_actions WHERE action='test'").n, 1);
  const before = one('SELECT COUNT(*) n FROM campaigns').n;
  await assert.rejects(c.createCampaignTest(account, d.id, { requestId: randomUUID(), revision: 1, phones: [phones[0], '01999999999'] }), /configured/);
  assert.equal(one('SELECT COUNT(*) n FROM campaigns').n, before);
  for (const patch of [{ phones: [] }, { phones: Array(11).fill(phones[0]) }, { phones: ['+8801700000001'] }, { phones, phone: phones[0] }, {}]) {
    assert.equal(c.testSendInput.safeParse({ requestId: randomUUID(), revision: 1, ...patch }).success, false);
  }
});
test('invitations share the sender mutex and uncertainty hold with campaign dispatch', async () => {
  await c.ensureSender('admin', '01700000000');
  const reservation = await c.reserveInvitationSender(
    'fixture-invite',
    '01700000000',
  );
  await assert.rejects(
    c.reserveInvitationSender('fixture-other', '01700000000'),
    /busy/,
  );
  await c.finishInvitationReservation(reservation, 'unknown', null);
  assert.ok(
    one('SELECT active_attempt FROM sender_dispatch_state').active_attempt,
  );
  assert.ok(one('SELECT pause_reason FROM sender_dispatch_state').pause_reason);
});

test('concurrent duplicate queue delivery claims a single send and fences replayed workers', async () => {
  lead();
  const d = await prepared();
  await configure({ sendDelay: 50 });
  const part = messages(d.id)[0];
  await Promise.all([
    c.processCampaignPart('admin', d.id, part.id),
    c.processCampaignPart('admin', d.id, part.id),
  ]);
  assert.equal((await outgoing()).length, 1);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_send_attempts').n, 1);
});
test('concurrent optimistic edits cannot replace the winning draft after returning a conflict', async () => {
  const d = await draft();
  const results = await Promise.allSettled(
    ['First edit', 'Second edit'].map((name) =>
      c.editDraft(account, d.id, {
        name,
        content: { text: name, assetIds: [], separateText: false },
        audience: d.audience,
        revision: 1,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const current = await c.getCampaign('admin', d.id);
  const part = one('SELECT text FROM campaign_parts WHERE campaign_id=?', d.id);
  assert.equal(part.text, current.name);
  assert.equal(current.revision, 2);
});
test('delivered leads need no consent record and Do not contact controls preview, preparation, and subsequent parts', async () => {
  const id = lead();
  const audience = c.campaignAudienceInput.parse({ whatsapp: 'all' });
  assert.equal(one('SELECT COUNT(*) n FROM lead_marketing_permissions').n, 0);
  assert.equal((await c.previewAudience('admin', audience)).ready, 1);
  await assert.rejects(c.setExclusions('another-owner', { ids: [id], excluded: true }), /not found/);
  assert.equal(one('SELECT excluded FROM leads WHERE id=?', id).excluded, 0);
  await c.setExclusions('admin', { ids: [id], excluded: true });
  assert.equal((await c.previewAudience('admin', audience)).breakdown.excluded, 1);
  const excludedCampaign = await prepared();
  assert.equal(messages(excludedCampaign.id).length, 0);
  assert.equal(one('SELECT skip_reason FROM campaign_recipients WHERE campaign_id=?', excludedCampaign.id).skip_reason, 'excluded');
  await c.setExclusions('admin', { ids: [id], excluded: false });
  assert.equal((await c.previewAudience('admin', audience)).ready, 1);
  const active = await prepared({ text: 'hello', assetIds: [asset()], separateText: true });
  await c.processCampaignPart('admin', active.id, messages(active.id)[0].id);
  assert.equal((await outgoing()).length, 1);
  await c.setExclusions('admin', { ids: [id], excluded: true });
  tick(60);
  await c.processCampaignPart('admin', active.id, messages(active.id)[1].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(messages(active.id)[1].status, 'skipped');
  assert.equal(messages(active.id)[1].error, 'excluded');
});
test('legacy consent evidence does not override the current Leads contact preference', async () => {
  const id = lead();
  sql("INSERT INTO lead_marketing_permissions VALUES ('admin',?,'revoked','whatsapp_marketing','Historical fixture',?,'old-record')", id, now);
  const audience = c.campaignAudienceInput.parse({ whatsapp: 'all' });
  assert.equal((await c.previewAudience('admin', audience)).ready, 1);
  const campaign = await prepared();
  await c.processCampaignPart('admin', campaign.id, messages(campaign.id)[0].id);
  assert.equal((await outgoing()).length, 1);
  await c.setExclusions('admin', { ids: [id], excluded: true });
  assert.equal((await c.previewAudience('admin', audience)).breakdown.excluded, 1);
});
test('marking Do not contact during the final send claim prevents a gateway request', async () => {
  const id = lead(), campaign = await prepared();
  let marked = false;
  globalThis.__campaignEnv.DB = {
    ...binding,
    async batch(statements) {
      if (!marked) {
        marked = true;
        sql('UPDATE leads SET excluded=1 WHERE id=?', id);
      }
      return binding.batch(statements);
    },
  };
  try {
    await c.processCampaignPart('admin', campaign.id, messages(campaign.id)[0].id);
  } finally {
    globalThis.__campaignEnv.DB = binding;
  }
  assert.equal(marked, true);
  assert.equal((await outgoing()).length, 0);
  assert.equal(one('SELECT COUNT(*) n FROM campaign_send_attempts').n, 0);
});
test('cancellation during an external request records acceptance but never sends subsequent parts', async () => {
  lead();
  const d = await prepared({
    text: 'hello',
    assetIds: [asset()],
    separateText: true,
  });
  await configure({ sendDelay: 100 });
  const promise = c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  await new Promise((resolve) => setTimeout(resolve, 25));
  await launch(d, 'cancel');
  await promise;
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[1].id);
  assert.deepEqual(
    messages(d.id).map((m) => m.status),
    ['sent', 'cancelled'],
  );
  assert.equal((await outgoing()).length, 1);
});
test('recovery of a failed video preserves successful parts and records the original asset', async () => {
  lead();
  const original = asset('video'),
    d = await prepared({
      text: 'hello',
      assetIds: [asset(), original],
      separateText: false,
    });
  await configure({ partStatuses: [200, 400] });
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  tick(60);
  await c.processCampaignPart('admin', d.id, messages(d.id)[1].id);
  const replacement = asset('video');
  await c.campaignAction(account, d.id, {
    action: 'recover_part',
    revision: 1,
    requestId: randomUUID(),
    messageId: messages(d.id)[1].id,
    assetId: replacement,
    evidence: 'Replaced invalid fixture video',
  });
  assert.equal(messages(d.id)[0].status, 'sent');
  assert.equal(messages(d.id)[1].status, 'pending');
  assert.equal(
    JSON.parse(
      one(
        "SELECT evidence_json FROM campaign_actions WHERE action='recover_part'",
      ).evidence_json,
    ).originalAssetId,
    original,
  );
});
test('scheduled Cron replay does not duplicate preparation or fixed membership', async () => {
  lead();
  const d = await draft();
  await launch(d, 'schedule', { scheduledAt: now + 3600 });
  await c.prepareCampaign('admin', d.id);
  assert.equal((await c.getCampaign('admin', d.id)).status, 'scheduled');
  await c.recoverCampaigns();
  await c.recoverCampaigns();
  assert.equal((await outgoing()).length, 0);
  tick(3600);
  await c.recoverCampaigns();
  await c.recoverCampaigns();
  assert.equal((await c.getCampaign('admin', d.id)).status, 'running');
  assert.equal(one('SELECT COUNT(*) n FROM campaign_recipients').n, 1);
});
test('stale and unresolved registration checks are bounded without silently reporting no WhatsApp', async () => {
  for (let i = 0; i < 12; i++)
    lead({
      phone: `88019${String(i).padStart(8, '0')}`,
      exists: null,
      checked: null,
    });
  await configure({ numberCheckResponse: { invalid: true } });
  const d = await draft();
  await launch(d);
  await c.prepareCampaign('admin', d.id);
  assert.equal(
    one('SELECT COUNT(*) n FROM campaign_recipients WHERE prepared=1').n,
    5,
  );
  await c.prepareCampaign('admin', d.id);
  await c.prepareCampaign('admin', d.id);
  assert.equal(
    one(
      "SELECT COUNT(*) n FROM campaign_recipients WHERE skip_reason='not_verified'",
    ).n,
    12,
  );
  assert.equal(messages(d.id).length, 0);
});

test('unavailable prepared media fails the affected part and releases the rest of its sequence', async () => {
  lead();
  const a = asset(),
    d = await prepared({
      text: 'Test',
      assetIds: [a, asset('video')],
      separateText: false,
    });
  objects.clear();
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.deepEqual(
    messages(d.id).map((m) => m.status),
    ['failed', 'skipped'],
  );
  assert.equal((await c.getCampaign('admin', d.id)).status, 'completed');
  assert.equal((await outgoing()).length, 0);
});
test('changed sender identity blocks dispatch after launch', async () => {
  lead();
  const d = await prepared();
  await configure({
    session: { status: 'WORKING', me: { id: '8801812345678@c.us' } },
  });
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 0);
  assert.equal((await c.getCampaign('admin', d.id)).status, 'paused');
});
test('legacy verification changes after launch do not prevent an outgoing request', async () => {
  lead();
  const d = await prepared();
  sql("DELETE FROM campaign_provider_verifications WHERE owner_id='admin'");
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(messages(d.id)[0].status, 'sent');
  assert.equal(one('SELECT COUNT(*) n FROM campaign_send_attempts').n, 1);
});
test('a database failure after gateway acceptance holds the result and never replays it', async () => {
  lead();
  const d = await prepared();
  let failed = false;
  globalThis.__campaignEnv.DB = {
    ...binding,
    async batch(statements) {
      if (!failed && (await outgoing()).length) {
        failed = true;
        throw new Error('Synthetic post-acceptance persistence failure');
      }
      return binding.batch(statements);
    },
  };
  try {
    await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  } finally {
    globalThis.__campaignEnv.DB = binding;
  }
  assert.equal(failed, true);
  assert.equal(messages(d.id)[0].status, 'unconfirmed');
  assert.equal((await c.getCampaign('admin', d.id)).status, 'paused');
  assert.ok(one('SELECT active_attempt FROM sender_dispatch_state').active_attempt);
  tick(181);
  await c.recoverCampaigns();
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal((await outgoing()).length, 1);
  assert.equal(messages(d.id)[0].status, 'unconfirmed');
});
test('deactivation pauses a business test campaign before its first outgoing part', async () => {
  const owner = randomUUID();
  sql("INSERT INTO users(id,phone,company_name,password_hash,created_at) VALUES (?,'01812345678','Fixture','synthetic',?)", owner, now);
  const business = {...account,id:owner,role:'user',phone:'01812345678'};
  sql("INSERT INTO whatsapp_connections(owner_id,session_name,phone,status,checked_at) VALUES (?,?,'01812345678','WORKING',?)",owner,c.sessionFor(owner),now);
  await configure({sessions:{[c.sessionFor(owner)]:{status:'WORKING',me:{id:'8801812345678@c.us'}}}});
  sql("INSERT INTO campaign_test_destinations(owner_id,phone,evidence_ref) VALUES (?,'01700000001','Synthetic business control')",owner);
  const d = await c.createDraft(business,{name:'Business fixture',content:{text:'Test',assetIds:[],separateText:false},audience:{mode:'all'}});
  const t = await c.createCampaignTest(business,d.id,{requestId:randomUUID(),revision:1,phone:'01700000001'});
  sql('UPDATE users SET active=0 WHERE id=?',owner);
  await c.processCampaignPart(owner,t.id,messages(t.id)[0].id);
  assert.equal((await outgoing()).length,0);
  assert.equal((await c.getCampaign(owner,t.id)).status,'paused');
  assert.equal(messages(t.id)[0].status,'pending');
});
test('failed resolution ends unsent parts and audited recovery requests remain idempotent', async () => {
  lead();
  const d = await prepared({
    text: 'Test',
    assetIds: [asset()],
    separateText: true,
  });
  await configure({ sendStatus: 503 });
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  const input = {
    action: 'resolve',
    resolution: 'failed',
    evidence: 'Confirmed permanent failure in fixture',
    requestId: randomUUID(),
    revision: 1,
    messageId: messages(d.id)[0].id,
  };
  await c.campaignAction(account, d.id, input);
  await c.campaignAction(account, d.id, input);
  assert.deepEqual(
    messages(d.id).map((m) => m.status),
    ['failed', 'skipped'],
  );
  assert.equal(one('SELECT reserved FROM sender_dispatch_state').reserved, 0);
  assert.equal(
    one("SELECT COUNT(*) n FROM campaign_actions WHERE action='resolve'").n,
    1,
  );
});
test('expired invitation submissions are held and require explicit audited sender review', async () => {
  await c.ensureSender('admin', '01700000000');
  const invitation = randomUUID();
  sql(
    "INSERT INTO invitations(id,phone,token_hash,expires_at,request_id,created_by,created_at,sent_at,delivery_status) VALUES (?,'01712345678',?,? ,?,'admin',?,?,'sending')",
    invitation,
    'a'.repeat(64),
    now + 86400,
    randomUUID(),
    now,
    now,
  );
  const token = await c.reserveInvitationSender(invitation, '01700000000');
  tick(61);
  await c.recoverCampaigns();
  assert.equal(
    one('SELECT status FROM campaign_send_attempts WHERE id=?', token).status,
    'unconfirmed',
  );
  await assert.rejects(
    c.reserveInvitationSender(randomUUID(), '01700000000'),
    /paused/,
  );
  await assert.rejects(
    c.reviewSender(account, {
      requestId: randomUUID(),
      evidence: 'Checked fixture',
      invitationOutcome: 'unsent',
    }),
    /duplicate/,
  );
  await c.reviewSender(account, {
    requestId: randomUUID(),
    evidence: 'Checked no request survived in fixture',
    invitationOutcome: 'unsent',
    acknowledgeDuplicateRisk: true,
  });
  assert.equal(
    one('SELECT active_attempt FROM sender_dispatch_state').active_attempt,
    null,
  );
  assert.equal(
    one('SELECT delivery_status FROM invitations WHERE id=?', invitation)
      .delivery_status,
    'failed',
  );
});

test('archived evidence has a defined retention and account deletion queues private media cleanup', async () => {
  const owner = randomUUID();
  sql(
    "INSERT INTO users(id,phone,company_name,password_hash,created_at) VALUES (?,'01812345678','Fixture','synthetic',?)",
    owner,
    now,
  );
  const a = asset('image', owner);
  sql('UPDATE campaign_assets SET user_id=? WHERE id=?', owner, a);
  const business = {
    ...account,
    id: owner,
    role: 'user',
    phone: '01812345678',
  };
  const d = await c.createDraft(business, {
    name: 'Owned fixture',
    content: { text: 'Test', assetIds: [a], separateText: false },
    audience: { mode: 'all' },
  });
  sql('DELETE FROM users WHERE id=?', owner);
  assert.equal(one('SELECT COUNT(*) n FROM campaigns WHERE id=?', d.id).n, 0);
  assert.equal(
    one('SELECT COUNT(*) n FROM campaign_assets WHERE id=?', a).n,
    0,
  );
  assert.equal(
    one('SELECT COUNT(*) n FROM campaign_media_cleanup WHERE id=?', a).n,
    1,
  );
  await c.cleanupAssets();
  assert.equal(
    one('SELECT COUNT(*) n FROM campaign_media_cleanup WHERE id=?', a).n,
    0,
  );
  const archived = await draft();
  sql(
    "UPDATE campaigns SET status='archived',updated_at=? WHERE id=?",
    now - 15552001,
    archived.id,
  );
  await c.cleanupAssets();
  await assert.rejects(c.getCampaign('admin', archived.id), /not found/);
});


test('campaign cards count live filtered drafts and preserve launched membership', async () => {
  lead();
  lead({ sources: ['pathao'] });
  const d = await draft(undefined, { mode: 'all', whatsapp: 'all', minDeliveries: 2 });
  const list = () => c.listCampaigns('admin', new URL('https://example.com/api/campaigns'));
  let item = (await list()).items.find(row => row.id === d.id);
  assert.equal(item.leadCount, 1);
  assert.equal(item.recipients, 0);
  assert.equal('audienceJson' in item, false);
  lead();
  assert.equal((await list()).items.find(row => row.id === d.id).leadCount, 2);
  assert.equal((await c.listCampaigns('other', new URL('https://example.com/api/campaigns'))).total, 0);
  await launch(d);
  lead();
  assert.equal((await list()).items.find(row => row.id === d.id).leadCount, 2);
});

test('campaign deletion checks ownership and revision and removes draft children', async () => {
  const d = await draft();
  await assert.rejects(c.deleteCampaign({ ...account, id: 'other' }, d.id, d.revision), error => error.status === 404);
  await assert.rejects(c.deleteCampaign(account, d.id, d.revision + 1), error => error.status === 409);
  assert.equal(all('SELECT * FROM campaign_parts WHERE campaign_id=?', d.id).length, 1);
  assert.deepEqual(await c.deleteCampaign(account, d.id, d.revision), { deleted: true });
  assert.equal(all('SELECT * FROM campaigns WHERE id=?', d.id).length, 0);
  assert.equal(all('SELECT * FROM campaign_parts WHERE campaign_id=?', d.id).length, 0);
  assert.equal(all('SELECT * FROM campaign_actions WHERE campaign_id=?', d.id).length, 0);
});

test('active campaigns and unresolved sends cannot be deleted', async () => {
  lead();
  const d = await prepared();
  await assert.rejects(c.deleteCampaign(account, d.id, d.revision), error => error.status === 409);
  sql("UPDATE campaigns SET status='cancelled' WHERE id=?", d.id);
  const message = messages(d.id)[0];
  sql("INSERT INTO campaign_send_attempts(id,owner_id,message_id,status,submitted_at) VALUES (?,'admin',?,'unconfirmed',?)", randomUUID(), message.id, now);
  await assert.rejects(c.deleteCampaign(account, d.id, d.revision), error => error.status === 409);
  sql("UPDATE campaign_send_attempts SET status='sent' WHERE message_id=?", message.id);
  await c.deleteCampaign(account, d.id, d.revision);
  assert.equal(messages(d.id).length, 0);
  assert.equal(all('SELECT * FROM campaign_recipients WHERE campaign_id=?', d.id).length, 0);
  assert.equal(all('SELECT * FROM campaign_send_attempts WHERE message_id=?', message.id).length, 0);
});

test('upload validation allows MP4 through 100 MB and rejects larger files before storage', async () => {
  const request = (mime, bytes) => new Request('http://localhost/api/campaign-assets', {
    method: 'POST',
    headers: { 'Content-Type': mime, 'Content-Length': String(bytes) },
    body: new Uint8Array(1),
  });
  for (const bytes of [17 * 1024 * 1024, 100 * 1024 * 1024]) {
    await assert.rejects(c.uploadAsset(account, request('video/mp4', bytes)), error => error.status === 503 && /not configured/.test(error.message));
  }
  await assert.rejects(c.uploadAsset(account, request('video/mp4', 100 * 1024 * 1024 + 1)), error => error.status === 413 && /100 MB/.test(error.message));
  await assert.rejects(c.uploadAsset(account, request('image/jpeg', 5 * 1024 * 1024 + 1)), error => error.status === 413 && /5 MB/.test(error.message));
  assert.equal(one('SELECT COUNT(*) n FROM campaign_assets').n, 0);
});

test('media library isolates accounts and supports filename search, type filters and pagination', async () => {
  const first = asset('image'), second = asset('video'), privateAsset = asset('image', 'other-owner');
  sql("UPDATE campaign_assets SET original_name='Summer offer.png',library_saved=1 WHERE id=?", first);
  sql("UPDATE campaign_assets SET original_name='Launch clip.mp4',library_saved=1 WHERE id=?", second);
  const page = await c.listAssets('admin', new URLSearchParams('pageSize=1'));
  assert.equal(page.total, 2);
  assert.equal(page.pages, 2);
  const next = await c.listAssets('admin', new URLSearchParams('pageSize=1&page=2'));
  assert.notEqual(page.items[0].id, next.items[0].id);
  assert.ok(![...page.items, ...next.items].some(row => row.id === privateAsset));
  const filtered = await c.listAssets('admin', new URLSearchParams('kind=image&search=SUMMER'));
  assert.equal(filtered.items[0].id, first);
  assert.equal(filtered.total, 1);
  assert.equal('original_key' in filtered.items[0], false);
  await assert.rejects(c.listAssets('admin', new URLSearchParams('page=-1')), /valid media filters/);
  await assert.rejects(c.getAsset('admin', privateAsset), /not found/);
  await assert.rejects(c.deleteAsset('admin', privateAsset), /not found/);
});

test('saved library media survives cleanup and referenced files cannot be deleted', async () => {
  const saved = asset(), abandoned = asset();
  sql('UPDATE campaign_assets SET library_saved=1 WHERE id=?', saved);
  tick(86401);
  await c.cleanupAssets();
  assert.equal((await c.getAsset('admin', saved)).id, saved);
  await assert.rejects(c.getAsset('admin', abandoned), /not found/);
  const d = await c.createDraft(account, { name: 'Library fixture', content: { text: 'Offer', assetIds: [saved], separateText: false }, audience: { mode: 'all' } });
  const listed = await c.listAssets('admin', new URLSearchParams());
  assert.equal(listed.items[0].in_use, 1);
  await assert.rejects(c.deleteAsset('admin', saved), /referenced/);
  await c.deleteCampaign(account, d.id, d.revision);
  await c.deleteAsset('admin', saved);
  await assert.rejects(c.getAsset('admin', saved), /not found/);
});


test('live progress counts every message outcome and reasons, including partial sequences and preparation skips', async () => {
  lead();
  lead({ excluded: 1 });
  lead({ exists: 0 });
  const d = await prepared({ text: 'hello', assetIds: [asset(), asset('video')], separateText: true });
  const parts = messages(d.id);
  assert.equal(parts.length, 3);
  sql("UPDATE campaign_messages SET status='sent',accepted_at=?,delivered_at=?,read_at=? WHERE id=?", now, now, now, parts[0].id);
  sql("UPDATE campaign_messages SET status='failed',error='Attachment rejected' WHERE id=?", parts[1].id);
  sql("UPDATE campaign_messages SET status='skipped',error='Previous part failed' WHERE id=?", parts[2].id);
  const progress = await c.campaignProgress('admin', d.id);
  assert.equal(progress.recipientTotal, 3);
  assert.equal(progress.preparation_done, 3);
  assert.equal(progress.recipientCounts.partially_sent, 1);
  assert.equal(progress.recipientCounts.skipped, 2);
  assert.deepEqual({ ...progress.messageCounts }, { total: 3, sent: 1, pending: 0, submitting: 0, skipped: 1, failed: 1, unconfirmed: 0, cancelled: 0, delivered: 1, read: 1, nextDue: null });
  assert.deepEqual(progress.recipientSkipReasons.map(r => [r.reason, r.count]).sort(), [['excluded', 1], ['no_whatsapp', 1]]);
  assert.deepEqual(progress.messageReasons.map(r => [r.status, r.reason, r.count]).sort(), [['failed', 'Attachment rejected', 1], ['skipped', 'Previous part failed', 1]]);
  assert.equal(progress.checkedAt, now);
  await assert.rejects(c.campaignProgress('other', d.id), /not found/);
});

test('live progress reports preparation immediately, zero outcomes, and all pending/in-flight states without sending', async () => {
  lead();
  const d = await draft({ text: 'hello', assetIds: [asset(), asset('video')], separateText: true });
  await launch(d);
  const before = await c.campaignProgress('admin', d.id);
  assert.equal(before.status, 'preparing');
  assert.equal(before.preparation_done, 0);
  assert.equal(before.messageCounts.total, 0);
  assert.equal(before.messageCounts.failed, 0);
  const recipient = one('SELECT id FROM campaign_recipients WHERE campaign_id=?', d.id);
  sql('UPDATE campaign_recipients SET prepared=1 WHERE id=?', recipient.id);
  assert.equal((await c.campaignProgress('admin', d.id)).preparation_done, 1);
  sql('UPDATE campaign_recipients SET prepared=0 WHERE id=?', recipient.id);
  await c.prepareCampaign('admin', d.id);
  const parts = messages(d.id);
  for (const [index, state] of ['pending', 'submitting', 'unconfirmed'].entries()) sql('UPDATE campaign_messages SET status=? WHERE id=?', state, parts[index].id);
  const progress = await c.campaignProgress('admin', d.id);
  assert.equal(progress.messageCounts.pending, 1);
  assert.equal(progress.messageCounts.submitting, 1);
  assert.equal(progress.messageCounts.unconfirmed, 1);
  assert.equal(progress.messageCounts.sent, 0);
  assert.equal(progress.messageCounts.nextDue, now);
  assert.equal((await outgoing()).length, 0);
});

test('sender pacing defers directly onto the background queue without waiting for cron or a browser', async () => {
  lead();
  const d = await prepared();
  sql("INSERT INTO sender_dispatch_state(owner_id,session_name,phone,next_allowed_at) VALUES ('admin','admin','01700000000',?)", now + 6);
  jobs = [];
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.ok(jobs.some(job => job.task === 'send' && job.workId === messages(d.id)[0].id));
  assert.equal((await outgoing()).length, 0);
  assert.equal(messages(d.id)[0].due_at, now + 6);
  tick(6);
  await c.processCampaignPart('admin', d.id, messages(d.id)[0].id);
  assert.equal(messages(d.id)[0].status, 'sent');
});
