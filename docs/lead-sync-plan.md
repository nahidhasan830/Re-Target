# Leads and courier synchronization

Implemented on 2 October 2026. Courier connection is one form action: save the merchant login, verify access, and queue an initial import. Connected accounts have an **Update connection** action enabled after editing credentials and a **View leads** link.

## Data and ownership

- `leads`: one customer per `(owner_id, phone)`. Phones are canonical `8801…` internally and local `01…` in the UI. Import updates source name/address without changing contact exclusions.
- `shipments`: courier evidence unique by `(owner_id, provider, source_account_id, shipment_id)`, with recipient snapshots, source timestamps, status, nullable lead link and pending/complete detail state. A composite foreign key prevents association with another owner's lead.
- `courier_credentials`: encrypted owner/provider credentials and renewable sessions, credential version and verified merchant identity.
- `courier_sync_runs`: owner/provider, trigger, credential version, merchant identity, queued/running/complete/failed/superseded status, durable cursor, checkpoint, scanned/skipped counts, safe error, retry counter, lease and dates. New-lead counts come from the run associated with each lead's first import.

Full deliveries from either courier and Pathao partial deliveries qualify. Unknown, pending, cancelled and Steadfast partial deliveries do not qualify on their own. Counts derive from stored evidence. Generic source update dates never become delivery dates. Imported contacts and history remain stored when a source changes status, but qualification follows current recorded evidence.

Every HTTP operation derives ownership from the authenticated session. Background workers resolve the owner from the stored run and load only that owner's credentials. Queue messages contain only run ID and checkpoint. No sample credentials or cross-business fallback is used. Merchant IDs partition shipment identity; replacing credentials invalidates prior runs and resets the traversal. Historical customers remain in that business's pool.

## Sources

Pathao traverses every numbered page at the fixed merchant origin with `transfer_status=2`, `limit=200`, and separate archive=0/archive=1 passes. Recipient details come from the list JSON. Delivered and Partial Delivery retain distinct normalized statuses.

Steadfast traverses every opaque next cursor from the delivered HTML list, including pages of known consignment IDs. Newly discovered IDs are stored as pending before detail requests. Batches of five pending IDs fetch `/user/consignment/{id}` and parse the primary recipient phone, name, address, tracking code, creation date and explicit delivery events. Completed IDs reuse their details on subsequent scans. Unexpected HTML or pagination yields a visible failure rather than a successful empty import.

Steadfast uses the authenticated Node relay in `infra/steadfast-transport`, separately deployed to Vercel. Both relay and client permit only login, account verification, delivered-list cursor reads and numeric consignment detail reads. The relay has no session storage, follows no redirects, restricts headers and request/response sizes, and returns cookies to the encrypted session manager. It parses full list/detail HTML using the shared parcel adapter and sends a compact representation of only those fields to the Worker, keeping import batches within Cloudflare Free CPU limits. Set `STEADFAST_TRANSPORT_URL` and `STEADFAST_TRANSPORT_TOKEN` in local and production server secrets. Deploy this relay independently with `npm run relay:deploy`; `npm run relay:build` bundles the shared parser into the relay.

## Execution

`src/worker.ts` preserves Astro HTTP handling and adds Cloudflare Queue and Cron handlers. `re-target-lead-sync` runs one page or a bounded detail batch per message. Provider runs are independent. A partial unique index allows one active run per owner/provider; checkpoint identities and fenced leases make redelivery and overlapping triggers safe. Parcel writes and pagination checkpoints commit together. Credential changes and deactivated accounts prevent stale writes.

A five-minute Cron Trigger recovers lost dispatches and expired leases, and starts connected providers whose last run started at least an hour ago. Existing connected accounts receive their initial import after deployment. Failures retry with bounded backoff; authentication errors require reconnecting. Durable pending details survive retries and new runs. Imports continue without an open browser.

`GET /api/leads/sync` reads owner-scoped progress. Same-origin, session-protected, throttled `POST /api/leads/sync` starts or reuses eligible runs. The Leads page polls progress, refreshes rows as leads arrive, and shows queued/running status, scanned parcels, new leads and actionable errors. An idle provider can be synced while another is active.

## Verification and deployment

`tests/lead-sync.test.mjs` covers migration preservation, parsers, pagination/archive coverage, Pathao partials, cross-courier deduplication, known-ID traversal, retry checkpoints, stale credential fencing, owner isolation, composite foreign keys and Cron recovery. API tests cover access, CSRF protection and owner-scoped status. Desktop and mobile UI checks use an isolated fixture.

`npm run deploy` builds, validates, provisions the background queue if missing, backs up D1, applies migrations, deploys the Worker and verifies the live release. Migration `0007_cuddly_multiple_man.sql` preserves prior shipments and adds source/run fields. Provider sources are merchant dashboard interfaces; changed courier responses remain visible and recoverable.
