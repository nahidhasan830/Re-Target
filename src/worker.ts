import { env } from 'cloudflare:workers';
import {
  campaignQueueMessage,
  prepareCampaign,
  processCampaignPart,
  recoverCampaigns,
} from './lib/campaign-delivery';
import { recoverEvents } from './lib/campaign-events';
import { cleanupAssets } from './lib/campaign-media';
import { handle } from '@astrojs/cloudflare/handler';
import {
  whatsAppCheckMessage,
  processWhatsAppChecks,
  recoverWhatsAppChecks,
} from './lib/lead-whatsapp';
import { processSync, scheduledSync, syncMessage } from './lib/lead-sync';

export default {
  fetch: handle,
  async queue(batch) {
    for (const message of batch.messages) {
      const campaign = campaignQueueMessage.safeParse(message.body);
      if (campaign.success) {
        try {
          if (batch.queue === 're-target-campaigns-dlq') {
            await env.DB.batch([
              env.DB.prepare(
                "UPDATE campaigns SET status='paused',updated_at=unixepoch() WHERE owner_id=? AND id=? AND status IN ('preparing','running','scheduled')",
              ).bind(campaign.data.ownerId, campaign.data.campaignId),
              env.DB.prepare(
                "INSERT INTO campaign_actions(id,owner_id,campaign_id,actor,action,request_id,input_hash,evidence_json,created_at) SELECT ?,?,?, 'system','infrastructure_failed',?,'queue',?,unixepoch() WHERE EXISTS(SELECT 1 FROM campaigns WHERE owner_id=? AND id=?) ON CONFLICT(owner_id,request_id) DO NOTHING",
              ).bind(
                crypto.randomUUID(),
                campaign.data.ownerId,
                campaign.data.campaignId,
                `dlq:${message.id}`,
                JSON.stringify({
                  workId: campaign.data.workId,
                  reason:
                    'Background work exhausted retries. Review and resume explicitly.',
                }),
                campaign.data.ownerId,
                campaign.data.campaignId,
              ),
            ]);
            message.ack();
            continue;
          }
          if (campaign.data.task === 'prepare')
            await prepareCampaign(
              campaign.data.ownerId,
              campaign.data.campaignId,
            );
          else
            await processCampaignPart(
              campaign.data.ownerId,
              campaign.data.campaignId,
              campaign.data.workId,
            );
          message.ack();
        } catch {
          message.retry({
            delaySeconds: Math.min(
              300,
              15 * 2 ** Math.min(message.attempts, 4),
            ),
          });
        }
        continue;
      }
      const check = whatsAppCheckMessage.safeParse(message.body);
      if (check.success) {
        try {
          await processWhatsAppChecks(check.data.ownerId);
          message.ack();
        } catch {
          message.retry({ delaySeconds: 300 });
        }
        continue;
      }
      const parsed = syncMessage.safeParse(message.body);
      if (!parsed.success) {
        message.ack();
        continue;
      }
      try {
        await processSync(parsed.data);
        message.ack();
      } catch {
        message.retry({
          delaySeconds: Math.min(300, 15 * 2 ** Math.min(message.attempts, 4)),
        });
      }
    }
  },
  async scheduled(controller) {
    if (controller.cron === '*/5 * * * *') {
      await scheduledSync();
      await recoverWhatsAppChecks();
      await cleanupAssets();
    }
    await recoverCampaigns();
    await recoverEvents();
  },
} satisfies ExportedHandler<Env>;
