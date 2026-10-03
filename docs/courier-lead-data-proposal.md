# Delivered parcel discovery and proposed lead model

Verified on 2 October 2026 through authenticated, read-only requests to the merchant endpoints supplied by the project owner. All returned list pages and every Steadfast parcel detail were fetched and normalized in a local preview. No application leads were inserted and no importer or deployment was enabled. Aggregate evidence is saved in courier-delivered-verification.json; the private normalized preview is in the ignored .wrangler/courier-lead-preview directory.

## Live results

| Provider | Response | Pagination verified | Parcels | Qualifying unique phones |
| --- | --- | --- | ---: | ---: |
| Pathao | JSON | 200 + 200 + 59 rows; limit=1000 returned the same 459 unique IDs in one request | 449 delivered + 10 partial | 431 |
| Steadfast | HTML for list and details | Ten rows per cursor page; 11 pages, with seven rows on the last page | 107 delivered | 104 |

Combined: **566 qualifying shipments (556 full deliveries and ten Pathao partial deliveries), 534 unique qualifying phones**, assuming both supplied merchant accounts belong to one Re-Target business. One phone appeared in both providers. All recipient phones normalized successfully. All 107 Steadfast detail requests succeeded and supplied explicit delivery-event timestamps. These are preview counts; the number of new application leads depends on existing stored contacts.

### Pathao

List: GET https://merchant.pathao.com/api/v1/orders/all?transfer_status=2&archive=0&page=1&limit=200

Authentication: existing bearer session; browser analytics cookies were unnecessary.

- Envelope: message, type, code, data. Rows: data.data. Pagination: data.total, current_page, per_page, last_page, total_in_page.
- limit=1000 returned the entire current sample. This does not establish an unlimited endpoint or a permanent maximum; retain bounded numbered pagination for larger histories.
- transfer_status=2 includes Partial Delivery. Both Delivered and Partial Delivery qualify for leads. Preserve partial status rather than relabelling it delivered.
- archive=0 covers unarchived records. archive=1 returned zero for this account; omitting archive returned the same 459. Include a separate archive pass when claiming full available history for other accounts.
- Returned pagination URLs point to an internal HTTP address and omit filters. Construct page requests using the fixed HTTPS merchant origin and preserve status/archive/limit parameters.
- order_status_updated_at is a status timestamp. Store it separately; the response does not explicitly establish the physical delivery time.

### Steadfast

List: GET https://steadfast.com.bd/user/consignment/status/delivered

Detail: GET https://steadfast.com.bd/user/consignment/{consignment_id}

Authentication: existing Laravel session/remember-me cookies. Remember-only access also succeeded during this verification.

- The list provides consignment ID, invoice, recipient name, address, date, COD, charge, current delivery/settlement badges, and detail link. **Recipient phone is absent.**
- Follow the enabled rel="next" link with its opaque cursor. Validate the HTTPS origin and delivered-list pathname. Do not manufacture cursors or substitute numbered pages.
- per_page=200&limit=200 still returned ten rows. No one-request all-records mode was established.
- Details provide the Recipient section with name, primary phone, address and area, plus tracking code and creation/approval dates.
- Extract phone only from the Recipient section: the page also contains rider and support numbers.
- Explicit delivery events were "Consignment has been marked as delivered by rider." and "Consignment has been marked as delivered." Their time elements contain datetime attributes with seconds and +06:00 offsets.
- All current rows had a Delivered badge and separate Cleared settlement badge. Store delivery and settlement separately. Historical badges/events elsewhere on the detail page must not replace current status.

These are verified merchant-dashboard endpoints, not a claim of public API support. Steadfast HTML structure must be validated; unexpected markup must fail visibly. Date filters, retention, rate limits and a changed-record feed remain unverified.

## Unified adapter output

Adapters return the same parcel structure before database writes. IDs and phones are strings. Return ISO timestamps with offsets; convert to UTC Unix seconds for persistence, matching the existing shipment tables.

```ts
type CourierParcel = {
  provider: 'pathao' | 'steadfast';
  sourceAccountId: string;
  shipmentId: string;
  merchantOrderId: string | null;
  trackingCode: string | null;
  recipient: {
    name: string;
    phone: string | null;
    address: string | null;
    area: string | null;
  };
  status: 'delivered' | 'partial' | 'pending' | 'cancelled' | 'unknown';
  rawStatus: string;
  settlementStatus: string | null;
  sourceCreatedAt: string | null;
  sourceStatusUpdatedAt: string | null;
  deliveredAt: string | null;
  deliveryDateSource: 'tracking_event' | null;
  observedAt: string;
};
```

Only verified status values receive a mapping. sourceAccountId is the courier merchant identity, distinct from Re-Target owner identity. Pathao's bearer payload contains a merchant ID and its profile endpoint provides merchant identity; Steadfast protected HTML exposes authenticated user ID. Resolve and persist identity during connection verification before importing or reusing progress.

| Unified field | Pathao | Steadfast |
| --- | --- | --- |
| shipmentId | order_consignment_id | Validated list/detail consignment ID |
| merchantOrderId | merchant_order_id | Invoice; empty dash becomes null |
| trackingCode | Not established in this list; null | Parcel details → Tracking code |
| recipient.name | recipient_name | Recipient section → name |
| recipient.phone | recipient_phone | Recipient section → Phone |
| recipient.address | recipient_address | Recipient section → address |
| recipient.area | Not established; null | Recipient section → area |
| rawStatus | order_status | Current delivery badge |
| settlementStatus | billing_status | Separate settlement badge |
| sourceCreatedAt | order_created_at | Parcel details → Created |
| sourceStatusUpdatedAt | order_status_updated_at | No equivalent verified; null |
| deliveredAt | Explicit Delivered. event from the parcel activity endpoint | Explicit delivered tracking-event timestamp |

Normalize local/country-code variants and Bangla digits to 8801XXXXXXXXX; display 01XXXXXXXXX. Missing/invalid primary phones cannot create usable leads. Never infer contacts from rider numbers, delivery notes or secondary phones.

A shared phone is this product's contact identity, not proof that every associated recipient name represents the same person. Keep source name/address snapshots on shipments.

## Credentials and account ownership

Manual sync resolves the account from the authenticated server session. The importer calls courierRead(account, provider, path); its session manager loads encrypted credentials and cached sessions using account.id and provider. Decryption is also bound to that owner/provider. Use that business's saved credentials for every list/detail request; never use the pasted verification tokens, a shared merchant login or another owner's credentials as fallback.

Set owner_id from the trusted account, never from a browser-supplied owner ID. All lead/parcel lookups, writes, joins, exclusions, sync runs and progress must use that same owner. Merge a shared phone only within one business. Admin sync uses the admin's own configured merchant accounts.

Background jobs carry the authorized owner/provider/run identity and resolve that owner's saved credentials at execution time. Validate the active account/run and credential/source identity before work or writes; changed credentials invalidate stale jobs. Persisting the job's owner lets scheduled sync continue for that business even while its user is logged out.

## Proposed storage

Extend the current lead and shipment tables, and add sync state/runs. Full HTML, tokens, cookies, rider details and delivery notes are unnecessary for lead storage.

| Record | Fields | Identity/rule |
| --- | --- | --- |
| leads | Existing id, owner_id, user_id, phone, name, location, excluded, created_at; add updated_at | Unique (owner_id, phone). Persistent customer and outreach preference |
| shipments | Existing id, owner_id, provider, shipment_id, lead_id, recipient_name, recipient_phone, raw_status, status, delivered_at; add source_account_id, merchant_order_id, tracking_code, recipient_address, recipient_area, settlement_status, source_created_at, source_status_updated_at, delivery_date_source, details_status, details_fetched_at, detail_attempts, detail_retry_at, import_issue, first_seen_at, last_seen_at | Unique (owner_id, provider, source_account_id, shipment_id). Nullable lead_id until a valid phone is available; enforce matching owner |
| courier_sync_state | Owner/provider/source account, active run, enabled state, credential fencing identity, checkpoint, last attempt/success, next due, lease owner/expiry, safe error | Progress belongs to the connected merchant. Source changes reset checkpoints |
| courier_sync_runs | Run identity, owner/provider/source account, trigger, status, start/end, checkpoint, scanned/new parcels, completed details, new leads, updated shipments, invalid/skipped items, detail failures, safe error | Distinguish partial work from complete success |

details_status is pending, complete or failed. Merely discovering an ID must not mark its details complete. Pathao can complete rows directly from the list. Steadfast completes rows after detail parsing. Invalid primary phones can retain a complete shipment with lead_id=null and an import issue. Parsing/fetch failures remain retryable.

Derive sources and delivery_count from qualifying shipments: delivered from either courier, plus partial from Pathao only. Keep full_delivery_count and partial_delivery_count separately so the combined count does not misrepresent full deliveries. Derive latest_confirmed_delivery_at from explicit full-delivery events and qualifying Pathao partial-delivery events. Never increment counts on every sync. Pathao status timestamps may be exposed separately, without labelling them confirmed delivery dates.

Choose source display name/location from the most recently created qualifying shipment, with a stable provider/ID tie-breaker. Preserve exclusions and any future user overrides. Older backfill must not replace newer display values.

Keep Pathao page plus archive pass, or Steadfast cursor, as a checkpoint for an in-progress traversal. Start a new discovery run from the first page unless a reliable changed-record feed is later verified.

## Incremental merge

1. Traverse the delivered list and upsert each parcel by its scoped source identity.
2. **Steadfast: check consignment ID first. Fetch details for unseen IDs, or known pending/failed rows due for retry. Reuse saved details for known complete rows.** Visible list status/settlement changes can update without another detail fetch; explicit reconciliation may refresh old details when needed.
3. Pathao already supplies contact fields in each row. Normalize directly without per-parcel detail calls. Pathao partial rows also qualify for lead creation, retaining their partial status.
4. For a qualifying parcel (delivered from either courier, or partial from Pathao) with a valid phone, upsert the owner's lead by (owner_id, phone). A new phone adds a lead; an existing phone receives shipment history, including across couriers.
5. Commit shipment details, lead association and completion state together. Retries and duplicate jobs cannot create duplicate leads or permanently skip unfinished details.
6. Preserve exclusions and user-owned fields. Empty responses, disconnection or a parcel disappearing from a list never delete leads. Explicit status corrections can change audience qualification. If a shipment's phone changes, reassign its association and recalculate aggregates.
7. Reach the terminal page/cursor. **Do not stop at the first known ID or use only the largest ID.** An older parcel can become delivered later and appear beyond known rows; creation-ID order does not establish delivery order.

The outcome is the requested persistent merge: new courier customers join our own Leads list, while existing customers keep one row and accumulate delivery history.

## Implementation boundary

The Leads page, database reads/exclusions, and authentication for both couriers exist. Automatic imports, queue processing and scheduling remain to be implemented.

Implementation update: Re-Target now has a dedicated Steadfast Node transport in `infra/steadfast-transport`. Both transport sides allow validated delivered-list cursor reads and numeric consignment details. The live relay was verified using the saved merchant session. See `lead-sync-plan.md` for the implemented background workflow.

Initial import should traverse all available pages, including Pathao's archive pass where applicable. Use resumable batches and bounded retries as histories grow. A courier failure must not discard the other courier's successful work.


### Pathao delivery history verified on 2 October 2026

The official merchant frontend fetches GET `/api/v1/orders/{consignmentId}/{localRecipientPhone}/activity?archive={0|1}` for history. Three delivered parcels returned HTTP 200 and an explicit `data.log[].desc = "Delivered."` entry with `created_at` in Bangladesh local time, formatted as `Oct 1, 2026 5:49 PM`. The list/detail `order_status_updated_at` values are UTC (the same sample was `2026-10-01 11:49:17`); they remain separate status evidence. Delivery history has minute precision.

The importer now retrieves this history in resumable batches of five after list discovery, records `delivery_checked_at`, and keeps the archive partition with the shipment. Existing shipments with no history check are backfilled during the next sync. Changed source status timestamps invalidate the cached history check. Missing explicit delivery events keep their date unknown; qualifying partial deliveries use their explicit Partially delivered. event.
