import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  return drizzle(env.DB, { schema });
}

export async function databaseReady() {
  const db = getDb();
  await db.select({ id: schema.campaigns.id }).from(schema.campaigns).limit(1);
  await db.select({ id: schema.campaignAssets.id }).from(schema.campaignAssets).limit(1);
  await db.select({ id: schema.products.id }).from(schema.products).limit(1);
  await db.select({ id: schema.adminSessions.tokenHash }).from(schema.adminSessions).limit(1);
  await db.select({ id: schema.adminAccounts.phone }).from(schema.adminAccounts).limit(1);
  await db.select({ id: schema.loginAttempts.key }).from(schema.loginAttempts).limit(1);
  await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  await db.select({ id: schema.invitations.id }).from(schema.invitations).limit(1);
  await db.select({ id: schema.userSessions.tokenHash }).from(schema.userSessions).limit(1);
  await db.select({ id: schema.whatsappConnections.ownerId }).from(schema.whatsappConnections).limit(1);
  await db.select({ id: schema.courierCredentials.ownerId }).from(schema.courierCredentials).limit(1);
  await db.select({ id: schema.leads.id }).from(schema.leads).limit(1);
  await db.select({ id: schema.shipments.id, sourceAccount: schema.shipments.sourceAccountId, deliveryCheckedAt: schema.shipments.deliveryCheckedAt }).from(schema.shipments).limit(1);
  await db.select({ id: schema.courierSyncRuns.id }).from(schema.courierSyncRuns).limit(1);
}
