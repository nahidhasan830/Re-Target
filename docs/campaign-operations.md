# Campaign setup and operation

Campaigns support full audiences across all lead pages, fixed launch membership, Bangla personalization, ordered images/videos, schedules, explicit tests, recipient results and audited recovery. Campaign sending is available as soon as the account connects WhatsApp. Test sends are optional; no verification, enablement setting or deployment flag is required. Configuring destinations does not send a message.

## Campaign navigation

Choose **Sending** on any campaign card or saved draft editor to open `/{admin|app}/campaigns/:id/sending`. Launched campaigns show live recipient and message evidence there. Drafts offer **Review & schedule** and **Recent test sends**; opening a test result goes to that test's dedicated Sending page. Launching or scheduling also opens Sending.

Editor steps have direct URLs under the appropriate `/admin` or `/app` prefix: `/campaigns/:id/audience`, `/campaigns/:id/message` and `/campaigns/:id/review`. New drafts use `/campaigns/new/audience`, `/campaigns/new/message` and `/campaigns/new/review`. Refresh and Back/Forward restore the selected step. Same-tab unsaved edits are retained in session storage scoped to the signed-in owner and campaign, and restored only when the campaign revision still matches. Use **Save draft** for server persistence; a newly assigned ID replaces the new-draft URLs and storage key.

Existing `/campaigns/:id` and `/campaigns/new` links still resolve. Editor URLs for launched or otherwise immutable campaigns redirect to Sending. Unknown views, including `/campaigns/new/sending`, return 404. Each route checks authentication and redirects to the account's admin or business prefix where necessary.

## Configuration

Apply the additive migrations through the existing deployment workflow. Campaign storage starts at `0010_campaigns.sql`; subsequent migrations preserve the existing lead query indexes and add dispatch fences, media cleanup and retention indexes. Do not rename already-applied migrations. `npm run deploy` provisions the configured courier, registration, campaign and dead-letter queues before publishing. The application and campaign migrations were deployed on 2 October 2026; production database/R2 health and protected campaign endpoints were verified. Production media preparation uses the protected Mac-hosted Docker service at `https://media.nahidlabs.com`.

The Worker requires two stable secrets of at least 32 characters: `WHATSAPP_WEBHOOK_SECRET` and `MEDIA_PREPARATION_KEY`. Deployment prepares missing secrets and preserves existing remote values. Keep them in private configuration, never in client code. Set:

| Setting | Value |
| --- | --- |
| `MEDIA_PREPARATION_URL` | Protected HTTPS origin of the Node preparation service, without `/prepare` |
| `MEDIA_PREPARATION_KEY` | Same secret on Worker and preparation service |
| `CAMPAIGN_MEDIA_ORIGIN` | Public HTTPS application origin reachable by WAHA; also used for signed event callbacks |
| `WHATSAPP_WEBHOOK_SECRET` | Same stable signing key configured by the application on its session webhook |

The R2 bucket stays private. WAHA receives a signed application URL valid for ten minutes, supporting repeat GET, HEAD and range requests. The Worker verifies prepared metadata/checksums before publishing an asset as ready. See [media service setup](../infra/media-preparation/README.md). The preparation service and protected route are provisioned; see its setup and verification commands in the linked README.

Localhost uses the shared production database, media bucket and queue producers. Keep production courier encryption and gateway secrets in `.dev.vars` and use `npm run dev` (background mode). Use the production-reachable media preparation URL and signing key; do not point shared campaign jobs at localhost. Media service development tests need Node 24, FFmpeg and FFprobe and use synthetic files with a mock gateway.

## Account test destinations

Open **WhatsApp → Test destinations**. Each account can verify and save up to 10 local Bangladeshi numbers with the saving account recorded automatically. These destinations apply to every campaign owned by that account. Business accounts start without destinations. Admin defaults come from the private `CAMPAIGN_TEST_NUMBERS` setting; saving a replacement list overrides those defaults.

The account's connected WhatsApp is the sender. Admin tests use the admin's connected number. In the campaign's review step, choose one or more configured receivers in the checkbox dropdown and press **Send test** explicitly. Select all is available. All selected numbers are verified before anything is queued, and duplicate numbers are included only once. The test creates one immutable campaign with the exact bundle for each receiver and shared results; open it from **Recent test sends**. It never substitutes an imported lead for the selected receiver and never consumes a lead's contact cooldown. Tests still use the sender's pacing, attempt budget and ambiguity locks.

## Verify and enable campaign sending

The installed gateway was inspected as WAHA `2026.9.1 CORE`, WPP engine, using pinned image `devlikeapro/waha:arm@sha256:b4216daddb7d5c1eb3ab99e608b76a005ec7523e766f923939d229718df4aafb`. Its source supports text/image/video requests, captions and SHA-512 webhook signatures. Source inspection and mock acceptance do not verify linked-device behavior on real WhatsApp clients.

Connect the intended WhatsApp number, create a campaign and launch it instantly or schedule it. Optional **Test destinations** under WhatsApp let you preview the campaign on numbers you control using **Send test** in the campaign review. No delivered test or client confirmation is required to launch, schedule or resume regular campaigns.

The Campaign sending setup panel and its verification/enablement APIs have been removed. Historical rows in `campaign_provider_verifications` and `campaign_delivery_settings` are retained but no longer consulted. Existing paused campaigns remain paused until explicitly resumed from Campaigns; changing the linked sender still pauses campaigns tied to the previous number. No database migration is needed for this change.

The implemented adapter targets WAHA/WPP. It does not implement official WhatsApp Business Platform templates or the later imo/other channels.

## Contact preferences and delivery behavior

Campaigns use delivered leads and the **Do not contact** preference in Leads. No separate consent record or JSON permission import is required. Mark a customer **Do not contact** when they ask to stop promotions; they remain in Leads but are skipped during audience preview, preparation, and sending. **Allow contact** clears that preference for future campaign eligibility. Existing campaign results stay intact, and the usual channel, cooldown, and delivery checks still apply.

Explicit inbound opt-outs recognized by the WhatsApp webhook also mark the lead **Do not contact** and suppress pending offers across the owner’s campaigns. Ordinary replies stop that recipient’s remaining sequence without changing their contact preference; only an exact quoted outgoing message is attributed to a campaign. Historical permission records and already-applied migrations are retained for compatibility, but do not control campaign eligibility.

Drafts use live filters. Starting/scheduling fixes membership and content; later courier imports do not join. Preparation refreshes stale registration checks in bounded batches. Exclusions, sender identity, account activity, replies, cooldown and the account’s sending setting are checked again before each outgoing part.

Defaults are 6 seconds between parts, 450 attempts per sender per Dhaka day and a seven-day lead contact cooldown. **Instant** starts sending as soon as audience preparation is complete, at any hour. **Schedule for later** uses the chosen date and time in Dhaka; there is no additional business-hour window. Daily attempt capacity resets at Dhaka midnight. Campaigns have no sending cutoff; legacy offer expiry values are ignored. One recipient's full sequence reserves budget before its first part. Invitations share the sender mutex and attempt budget. No downtime catch-up burst is allowed.

Messages accept 4,000 Unicode code points; captions use a conservative 1,024-character rendered limit. Long offers become a separate text part. Up to three attachments are allowed: still JPEG/PNG up to 5 MB, MP4 up to 100 MB and five minutes. Preparation flattens transparency onto the chosen background, strips image metadata and emits JPEG or H.264/AAC MP4. Oversized, malformed and mismatched files are rejected.

## Recovery and retention

Pause and cancel stop pending work. A request already submitted to WAHA cannot be retracted. Acceptance, delivery and read evidence are separate; an accepted request is never automatically repeated because a receipt is missing.

A timeout, ambiguous server response, malformed success or expired submitting lease becomes **unconfirmed**, holds the sender and pauses its campaigns. Inspect WhatsApp first. Expand the affected contact and choose **Check send** to record the verified result: sent with a WhatsApp message ID, failed, or a deliberate unsent retry with evidence and duplicate-risk acknowledgement. Recovery appears only after choosing that message; its internal ID is selected automatically. External sending cannot promise exactly-once behavior when the provider accepted a request but its response was lost. Successful parts stay successful.

Confirmed WhatsApp outreach restrictions (`server returned error 463`), new-contact caps (`475`), and gateway HTTP `401`, `403`, or `429` mark the rejected part and its unsent sequence **Skipped** with a specific reason. The sender and its active campaigns pause immediately; other recipients remain queued. Already accepted parts keep their sent history and the recipient remains partially sent. Restriction attempts consume their normal attempt budget; checks that stop a send before a claim do not. Skipped restriction parts are not automatically retried.

When WAHA supplies reachout-timelock or message-capping details in the session identity or signed session-status event, even a `WORKING` session pauses on an active restriction, `FIRST_WARNING`, `SECOND_WARNING`, or `CAPPED`. Launch, test creation, resume and sender review reject a restriction still reported by the gateway. Clearing a warning does not automatically resume campaigns. The installed WPP engine does not support the dedicated timelock/capping endpoints, so it cannot provide complete advance warning; documented sending errors are still recognized inside WAHA's HTTP 500 exception envelope. Raw upstream errors, stacks and echoed request bodies are not shown to users. Generic HTTP 500 errors remain unconfirmed and require review.

A definitively failed attachment offers **Replace attachment** inside the affected contact. Its original asset/attempt evidence is audited. Campaigns require explicit resume after a pause. Resume checks the original sender and outstanding attempts, then immediately publishes pending eligible message jobs, retaining schedules and pacing. The sender recovery UI has been removed; sender pauses and unconfirmed invitation requests remain held until resolved through the existing operational API. Dead-lettered jobs pause their campaign and expose an infrastructure error.

Session notifications are checked against the gateway's current connection before updating status. Delayed Starting/Failed notifications cannot pause a sender that has already reconnected with the same number. Actual disconnections, changed senders and restrictions still pause campaigns and require explicit resume. Test creation checks the sender again after configuring signed webhooks because configuration can restart the gateway session; a reconnecting session creates no test and asks the user to try again shortly.

Campaign cards show live matching lead counts for drafts and fixed recipient counts after launch. Edit opens a draft; Edit copy duplicates a launched campaign into a new editable draft. Delete permanently removes a draft, completed, cancelled or archived campaign and its message history after confirmation. Active campaigns must be cancelled first, and submitting or unconfirmed sends must be resolved before deletion. Archived campaigns and their message evidence are retained for 180 days after archive; other campaign history remains until archive or account deletion. Removing an account deletes its campaign snapshots and queues private media deletion. Ready files in the Media library remain until the owner deletes them. Legacy unsaved and failed uploads are swept after a 24-hour grace period; interrupted preparation is invalidated after ten minutes. Cleanup is bounded and retried. Keep database and encryption/signing key backups private.

## Live campaign progress

Launched campaigns use two desktop columns: summary and actions on the left, contacts with delivery status on the right. Mobile stacks these panels. Sent and Waiting message totals remain visible; other outcomes and receipts appear only when nonzero. A text or attachment is one message; sent means the gateway accepted it, while delivered requires a receipt. Contact rows distinguish Paused, Waiting, partially sent, Sent, Delivered and Read, and expand to show individual messages. Single-page pagination, internal message IDs and the standalone recovery disclosure are omitted. Recent test sends live in the draft's Review step, outside composition and preview.

The detail screen checks an authenticated, account-scoped progress endpoint every five seconds while visible. It refreshes the current recipient page, retains expanded details, preserves summary focus, and leaves recovery inputs intact. Paused and completed campaigns continue updating so recovery and late receipts appear. Hidden tabs stop polling and refresh on return. Failed updates retain the last results, show the failure, and retry; Refresh is also available.

The queue consumer prepares recipients and sends message parts without an open browser. The screen distinguishes preparation, an in-flight send, queued work, future pacing/schedule waits, pauses and completion. Short deferrals publish a delayed queue job immediately; the existing recovery cron remains the fallback for longer delays and infrastructure recovery. Reading progress never starts or retries a send.

## Verification performed

`npm run verify` uses mocked bindings, ephemeral in-memory data, synthetic media and mock gateways. It does not provision a local application database or alter runtime secrets. Tests cover ownership, full audiences, fixed revisions, ordering, concurrent/replayed dispatch, budgets, cooldown, late-night Instant sends, exact scheduled times, launch and dispatch without test setup, partial failure, ambiguity recovery, signed/early/out-of-order events, replies/opt-outs, cleanup and account deletion. Earlier isolated API checks exercised real streamed uploads, prepared media and range responses; that persistent local API test workflow has been removed. Browser checks covered 1440, 390 and 320-pixel layouts and playback of a prepared synthetic MP4.

Live gateway acceptance, real WhatsApp formatting/playback, live delivery receipts and the opted-in production pilot remain pending. No real messages were sent during implementation, and account sending settings remain disabled until their owners verify delivery.

## Media library

Admin and business dashboards have an account-owned **Media** page with uploads, previews, filename search, image/video filters and pagination. Successful uploads are saved to the library; existing ready attachments were retained during migration. Campaigns select up to three ready files through **Choose media**, preserving selection order across pages and filters. Removing an attachment from a draft does not delete the library file. Files still referenced by campaign content or message history cannot be deleted. Original and prepared files stay private in R2, accessible only to the owning account or a signed delivery URL. Failed uploads can be removed or replaced from the Media page.
