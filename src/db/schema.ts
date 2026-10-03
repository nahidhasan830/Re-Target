import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => [
  check('products_name_length', sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
  check('products_price_range', sql`${table.priceCents} BETWEEN 0 AND 2147483647`),
]);

export const adminSessions = sqliteTable('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  phone: text('phone').notNull(),
  credentialVersion: text('credential_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('admin_sessions_expiry').on(table.expiresAt)]);

export const adminAccounts = sqliteTable('admin_accounts', {
  phone: text('phone').primaryKey(),
  companyName: text('company_name').notNull().default('Re-Target'),
  passwordHash: text('password_hash'),
  sourceCredentialVersion: text('source_credential_version'),
}, (table) => [check('admin_company_length', sql`length(trim(${table.companyName})) BETWEEN 1 AND 120`)]);

export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('login_attempts_expiry').on(table.expiresAt)]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull().unique(),
  companyName: text('company_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  credentialVersion: integer('credential_version').notNull().default(1),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  check('users_phone_format', sql`length(${table.phone}) = 11 AND ${table.phone} GLOB '01[0-9]*' AND ${table.phone} NOT GLOB '*[^0-9]*'`),
  check('users_company_length', sql`length(trim(${table.companyName})) BETWEEN 1 AND 120`),
]);

export const userSessions = sqliteTable('user_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialVersion: integer('credential_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('user_sessions_expiry').on(table.expiresAt), index('user_sessions_user').on(table.userId)]);

export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status', { enum: ['pending', 'accepted', 'revoked'] }).notNull().default('pending'),
  expiresAt: integer('expires_at').notNull(),
  deliveryStatus: text('delivery_status', { enum: ['sending', 'sent', 'failed', 'unknown'] }).notNull(),
  deliveryError: text('delivery_error'),
  messageId: text('message_id'),
  requestId: text('request_id').notNull().unique(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  sentAt: integer('sent_at').notNull(),
  acceptedAt: integer('accepted_at'),
  userId: text('user_id').references(() => users.id),
}, (table) => [index('invitations_created').on(table.createdAt)]);

export const whatsappConnections = sqliteTable('whatsapp_connections', {
  ownerId: text('owner_id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sessionName: text('session_name').notNull().unique(),
  phone: text('phone'),
  status: text('status').notNull().default('STOPPED'),
  checkedAt: integer('checked_at').notNull().default(0),
  operationId: text('operation_id'),
  operationUntil: integer('operation_until').notNull().default(0),
}, (table) => [uniqueIndex('whatsapp_connections_phone').on(table.phone)]);

export const courierCredentials = sqliteTable('courier_credentials', {
  ownerId: text('owner_id').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['pathao', 'steadfast'] }).notNull(),
  encryptedCredentials: text('encrypted_credentials').notNull(),
  encryptedSession: text('encrypted_session'),
  sessionVersion: integer('session_version').notNull().default(0),
  credentialVersion: integer('credential_version').notNull().default(0),
  sourceAccountId: text('source_account_id'),
  authLock: text('auth_lock'),
  authLockExpiresAt: integer('auth_lock_expires_at').notNull().default(0),
  retryAfter: integer('retry_after').notNull().default(0),
  authError: text('auth_error'),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.provider] }),
  check('courier_provider', sql`${table.provider} IN ('pathao', 'steadfast')`),
]);

export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  name: text('name').notNull().default(''),
  location: text('location'),
  excluded: integer('excluded', { mode: 'boolean' }).notNull().default(false),
  whatsappExists: integer('whatsapp_exists', { mode: 'boolean' }),
  whatsappChatId: text('whatsapp_chat_id'),
  whatsappCheckedAt: integer('whatsapp_checked_at'),
  whatsappCheckUntil: integer('whatsapp_check_until').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  sourceCreatedAt: integer('source_created_at'),
  firstImportRunId: text('first_import_run_id'),
}, (table) => [
  uniqueIndex('leads_owner_phone').on(table.ownerId, table.phone),
  uniqueIndex('leads_owner_id').on(table.ownerId, table.id),
  index('leads_import_run').on(table.ownerId, table.firstImportRunId),
  index('leads_pending_whatsapp').on(table.ownerId, table.whatsappCheckUntil, table.createdAt, table.id).where(sql`${table.whatsappExists} IS NULL`),
  check('leads_whatsapp_exists', sql`${table.whatsappExists} IS NULL OR ${table.whatsappExists} IN (0, 1)`),
  check('leads_phone_format', sql`length(${table.phone}) = 13 AND ${table.phone} GLOB '8801[3-9]*' AND ${table.phone} NOT GLOB '*[^0-9]*'`),
]);

export const shipments = sqliteTable('shipments', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  leadId: text('lead_id'),
  sourceAccountId: text('source_account_id').notNull().default('legacy'),
  recipientAddress: text('recipient_address'),
  sourceCreatedAt: integer('source_created_at'),
  merchantOrderId: text('merchant_order_id'),
  trackingCode: text('tracking_code'),
  parcelValueCents: integer('parcel_value_cents'),
  detailsStatus: text('details_status', { enum: ['pending', 'complete'] }).notNull().default('complete'),
  firstImportRunId: text('first_import_run_id'),
  provider: text('provider', { enum: ['pathao', 'steadfast'] }).notNull(),
  shipmentId: text('shipment_id').notNull(),
  recipientName: text('recipient_name'),
  recipientPhone: text('recipient_phone'),
  rawStatus: text('raw_status').notNull(),
  status: text('status', { enum: ['delivered', 'pending', 'cancelled', 'partial', 'unknown'] }).notNull(),
  deliveredAt: integer('delivered_at'),
  sourceUpdatedAt: integer('source_updated_at'),
  sourceArchive: integer('source_archive').notNull().default(0),
  deliveryCheckedAt: integer('delivery_checked_at'),
}, (table) => [
  uniqueIndex('shipments_owner_source').on(table.ownerId, table.provider, table.sourceAccountId, table.shipmentId),
  foreignKey({ columns: [table.ownerId, table.leadId], foreignColumns: [leads.ownerId, leads.id] }).onDelete('cascade'),
  index('shipments_pending_details').on(table.ownerId, table.provider, table.sourceAccountId, table.detailsStatus),
  index('shipments_pending_delivery').on(table.ownerId, table.provider, table.sourceAccountId, table.status, table.deliveryCheckedAt),
  index('shipments_unchecked_pathao').on(table.ownerId, table.sourceAccountId, table.shipmentId).where(sql`${table.provider} = 'pathao' AND ${table.status} IN ('delivered', 'partial') AND ${table.recipientPhone} IS NOT NULL AND ${table.deliveryCheckedAt} IS NULL`),
  index('shipments_owner_lead').on(table.ownerId, table.leadId, table.status),
  check('shipments_parcel_value', sql`${table.parcelValueCents} IS NULL OR ${table.parcelValueCents} >= 0`),
  check('shipments_provider', sql`${table.provider} IN ('pathao', 'steadfast')`),
  check('shipments_status', sql`${table.status} IN ('delivered', 'pending', 'cancelled', 'partial', 'unknown')`),
]);


export const courierSyncRuns = sqliteTable('courier_sync_runs', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  provider: text('provider', { enum: ['pathao', 'steadfast'] }).notNull(),
  credentialVersion: integer('credential_version').notNull(),
  sourceAccountId: text('source_account_id'),
  trigger: text('trigger', { enum: ['connect', 'manual', 'scheduled'] }).notNull(),
  status: text('status', { enum: ['queued', 'running', 'complete', 'failed', 'superseded'] }).notNull().default('queued'),
  cursor: text('cursor'),
  step: integer('step').notNull().default(0),
  scanned: integer('scanned').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  leaseToken: text('lease_token'),
  leaseUntil: integer('lease_until').notNull().default(0),
  dispatchedAt: integer('dispatched_at').notNull().default(0),
  startedAt: integer('started_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  completedAt: integer('completed_at'),
}, table => [
  uniqueIndex('courier_sync_active').on(table.ownerId, table.provider).where(sql`${table.status} IN ('queued', 'running')`),
  index('courier_sync_recent').on(table.ownerId, table.provider, table.startedAt),
  index('courier_sync_completed').on(table.ownerId, table.provider, table.completedAt).where(sql`${table.status} = 'complete'`),
  index('courier_sync_recovery').on(table.status, table.leaseUntil, table.dispatchedAt),
  check('sync_provider', sql`${table.provider} IN ('pathao', 'steadfast')`),
  check('sync_status', sql`${table.status} IN ('queued', 'running', 'complete', 'failed', 'superseded')`),
]);

export const campaigns = sqliteTable('campaigns', {
  editToken: text('edit_token'),
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  userId: text('user_id'),
  name: text('name').notNull(),
  status: text('status').notNull().default(sql`'draft'`),
  revision: integer('revision').notNull().default(sql`1`),
  contentJson: text('content_json').notNull(),
  audienceJson: text('audience_json').notNull(),
  companyName: text('company_name').notNull(),
  senderPhone: text('sender_phone'),
  scheduledAt: integer('scheduled_at'),
  expiresAt: integer('expires_at'),
  launchStatus: text('launch_status'),
  preparationCursor: text('preparation_cursor').notNull().default(sql`''`),
  preparationDone: integer('preparation_done').notNull().default(sql`0`),
  preparationToken: text('preparation_token'),
  preparationUntil: integer('preparation_until').notNull().default(sql`0`),
  isTest: integer('is_test').notNull().default(sql`0`),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('campaigns_owner').on(table.ownerId, table.createdAt, table.id),
  index('campaigns_due').on(table.status, table.scheduledAt),
  index('campaigns_retention').on(table.status,table.updatedAt),
  uniqueIndex('campaigns_ownerId_id_unique').on(table.ownerId, table.id),
  foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
]);

export const campaignAssets = sqliteTable('campaign_assets', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  userId: text('user_id'),
  originalName: text('original_name').notNull(),
  originalKey: text('original_key').notNull(),
  preparedKey: text('prepared_key'),
  kind: text('kind').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  checksum: text('checksum').notNull(),
  state: text('state').notNull(),
  width: integer('width'),
  height: integer('height'),
  background: text('background').notNull().default(sql`'#ffffff'`),
  error: text('error'),
  librarySaved: integer('library_saved').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('campaign_assets_library').on(table.ownerId, table.state, table.createdAt, table.id),
  index('campaign_assets_cleanup').on(table.state, table.createdAt),
  uniqueIndex('campaign_assets_ownerId_id_unique').on(table.ownerId, table.id),
  foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
]);

export const campaignParts = sqliteTable('campaign_parts', {
  ownerId: text('owner_id').notNull(),
  campaignId: text('campaign_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  kind: text('kind').notNull(),
  text: text('text').notNull().default(sql`''`),
  assetId: text('asset_id'),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.campaignId, table.ordinal] }),
  foreignKey({ columns: [table.ownerId, table.assetId], foreignColumns: [campaignAssets.ownerId, campaignAssets.id] }).onDelete('restrict'),
  foreignKey({ columns: [table.ownerId, table.campaignId], foreignColumns: [campaigns.ownerId, campaigns.id] }).onDelete('cascade'),
]);

export const leadMarketingPermissions = sqliteTable('lead_marketing_permissions', {
  ownerId: text('owner_id').notNull(),
  leadId: text('lead_id').notNull(),
  status: text('status').notNull(),
  scope: text('scope').notNull().default(sql`'whatsapp_marketing'`),
  source: text('source').notNull(),
  recordedAt: integer('recorded_at').notNull(),
  evidenceRef: text('evidence_ref').notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.leadId] }),
  foreignKey({ columns: [table.ownerId, table.leadId], foreignColumns: [leads.ownerId, leads.id] }).onDelete('cascade'),
]);

export const campaignRecipients = sqliteTable('campaign_recipients', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  campaignId: text('campaign_id').notNull(),
  leadId: text('lead_id'),
  phone: text('phone').notNull(),
  name: text('name').notNull(),
  chatId: text('chat_id'),
  evidenceJson: text('evidence_json').notNull(),
  skipReason: text('skip_reason'),
  reasonsJson: text('reasons_json').notNull().default(sql`'[]'`),
  prepared: integer('prepared').notNull().default(sql`0`),
  reserved: integer('reserved').notNull().default(sql`0`),
  budgetDate: text('budget_date'),
  repliedAt: integer('replied_at'),
}, (table) => [
  index('campaign_recipients_campaign').on(table.ownerId, table.campaignId, table.id),
  uniqueIndex('campaign_recipients_ownerId_campaignId_leadId_unique').on(table.ownerId, table.campaignId, table.leadId),
  uniqueIndex('campaign_recipients_ownerId_id_unique').on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.leadId], foreignColumns: [leads.ownerId, leads.id] }).onDelete('cascade'),
  foreignKey({ columns: [table.ownerId, table.campaignId], foreignColumns: [campaigns.ownerId, campaigns.id] }).onDelete('cascade'),
]);

export const campaignMessages = sqliteTable('campaign_messages', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  campaignId: text('campaign_id').notNull(),
  recipientId: text('recipient_id').notNull(),
  ordinal: integer('ordinal').notNull(),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  assetId: text('asset_id'),
  status: text('status').notNull().default(sql`'pending'`),
  dueAt: integer('due_at').notNull(),
  leaseToken: text('lease_token'),
  leaseUntil: integer('lease_until').notNull().default(sql`0`),
  gatewayId: text('gateway_id'),
  error: text('error'),
  acceptedAt: integer('accepted_at'),
  deliveredAt: integer('delivered_at'),
  readAt: integer('read_at'),
  retryCount: integer('retry_count').notNull().default(sql`0`),
}, (table) => [
  index('campaign_messages_gateway').on(table.ownerId, table.gatewayId),
  index('campaign_messages_recipient').on(table.ownerId, table.recipientId, table.ordinal, table.status),
  index('campaign_messages_due').on(table.status, table.dueAt, table.ownerId),
  uniqueIndex('campaign_messages_ownerId_recipientId_ordinal_unique').on(table.ownerId, table.recipientId, table.ordinal),
  uniqueIndex('campaign_messages_ownerId_id_unique').on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.assetId], foreignColumns: [campaignAssets.ownerId, campaignAssets.id] }).onDelete('restrict'),
  foreignKey({ columns: [table.ownerId, table.recipientId], foreignColumns: [campaignRecipients.ownerId, campaignRecipients.id] }).onDelete('cascade'),
  foreignKey({ columns: [table.ownerId, table.campaignId], foreignColumns: [campaigns.ownerId, campaigns.id] }).onDelete('cascade'),
]);

export const campaignSendAttempts = sqliteTable('campaign_send_attempts', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  messageId: text('message_id'),
  invitationId: text('invitation_id'),
  status: text('status').notNull(),
  submittedAt: integer('submitted_at').notNull(),
  finishedAt: integer('finished_at'),
  gatewayId: text('gateway_id'),
  error: text('error'),
  resolutionJson: text('resolution_json'),
}, (table) => [
  index('campaign_attempts_sender').on(table.ownerId, table.submittedAt),
  foreignKey({ columns: [table.ownerId, table.messageId], foreignColumns: [campaignMessages.ownerId, campaignMessages.id] }).onDelete('cascade'),
]);

export const senderDispatchState = sqliteTable('sender_dispatch_state', {
  activeRecipient: text('active_recipient'),
  ownerId: text('owner_id').primaryKey(),
  sessionName: text('session_name').notNull(),
  phone: text('phone').notNull(),
  activeAttempt: text('active_attempt'),
  leaseUntil: integer('lease_until').notNull().default(sql`0`),
  nextAllowedAt: integer('next_allowed_at').notNull().default(sql`0`),
  budgetDate: text('budget_date').notNull().default(sql`''`),
  consumed: integer('consumed').notNull().default(sql`0`),
  reserved: integer('reserved').notNull().default(sql`0`),
  pauseReason: text('pause_reason'),
  lastDispatchAt: integer('last_dispatch_at').notNull().default(sql`0`),
});

export const leadContactState = sqliteTable('lead_contact_state', {
  ownerId: text('owner_id').notNull(),
  leadId: text('lead_id').notNull(),
  activeRecipient: text('active_recipient'),
  lastContactAt: integer('last_contact_at'),
  nextAllowedAt: integer('next_allowed_at').notNull().default(sql`0`),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.leadId] }),
  foreignKey({ columns: [table.ownerId, table.leadId], foreignColumns: [leads.ownerId, leads.id] }).onDelete('cascade'),
]);

export const campaignOutbox = sqliteTable('campaign_outbox', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  campaignId: text('campaign_id').notNull(),
  kind: text('kind').notNull(),
  workId: text('work_id').notNull(),
  availableAt: integer('available_at').notNull(),
  dispatchToken: text('dispatch_token'),
  dispatchUntil: integer('dispatch_until').notNull().default(sql`0`),
}, (table) => [
  index('campaign_outbox_due').on(table.availableAt, table.dispatchUntil),
  foreignKey({ columns: [table.ownerId, table.campaignId], foreignColumns: [campaigns.ownerId, campaigns.id] }).onDelete('cascade'),
]);

export const whatsappEvents = sqliteTable('whatsapp_events', {
  ownerId: text('owner_id').notNull(),
  id: text('id').notNull(),
  sessionName: text('session_name').notNull(),
  event: text('event').notNull(),
  messageId: text('message_id'),
  payloadJson: text('payload_json').notNull(),
  receivedAt: integer('received_at').notNull(),
  matched: integer('matched').notNull().default(sql`0`),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.id] }),
  index('whatsapp_events_matching').on(table.ownerId, table.matched, table.messageId),
]);

export const campaignActions = sqliteTable('campaign_actions', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  campaignId: text('campaign_id'),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  requestId: text('request_id').notNull(),
  inputHash: text('input_hash').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  uniqueIndex('campaign_actions_ownerId_requestId_unique').on(table.ownerId, table.requestId),
  foreignKey({ columns: [table.ownerId, table.campaignId], foreignColumns: [campaigns.ownerId, campaigns.id] }).onDelete('cascade'),
]);

export const campaignProviderVerifications = sqliteTable('campaign_provider_verifications', {
  ownerId: text('owner_id').primaryKey(),
  senderPhone: text('sender_phone').notNull(),
  gatewayVersion: text('gateway_version').notNull(),
  evidenceRef: text('evidence_ref').notNull(),
  verifiedAt: integer('verified_at').notNull(),
  actor: text('actor').notNull(),
});

export const campaignDeliverySettings = sqliteTable('campaign_delivery_settings', {
  ownerId: text('owner_id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  senderPhone: text('sender_phone').notNull(),
  enabled: integer('enabled').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
  actor: text('actor').notNull(),
}, (table) => [check('campaign_delivery_settings_enabled_check', sql`${table.enabled} IN (0, 1)`)]);

export const campaignTestDestinations = sqliteTable('campaign_test_destinations', {
  ownerId: text('owner_id').notNull(),
  phone: text('phone').notNull(),
  chatId: text('chat_id'),
  checkedAt: integer('checked_at').notNull().default(sql`0`),
  evidenceRef: text('evidence_ref').notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.phone] }),
]);

export const campaignMediaCleanup = sqliteTable('campaign_media_cleanup', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), originalKey: text('original_key').notNull(), preparedKey: text('prepared_key'),
});
