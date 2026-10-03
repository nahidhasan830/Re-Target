# Campaign implementation plan

Re-Target campaigns will send formatted WhatsApp messages with images and videos to selected leads. The default audience is all qualifying leads with a registered WhatsApp account. Each campaign keeps a fixed recipient list and records every outgoing message separately, allowing delivery to recover without repeating successful parts.

This is a proposed implementation, based on the repository and documentation reviewed on 2 October 2026. It does not change the application or send messages. Numeric defaults below are product choices to validate during implementation, not guaranteed limits for avoiding WhatsApp restrictions.

Current behavior, 3 October 2026: Instant starts sending after preparation at any hour; scheduled delivery uses the selected time, with no business-hour window. The optional campaign expiry/cutoff feature has been removed. Verification and enable/disable settings now belong to each account’s WhatsApp dashboard and no deployment flag is needed. The earlier plan below is historical; [campaign operations](campaign-operations.md) describes current behavior.

Implementation update, 2 October 2026: campaign persistence, preparation, delivery, feedback and UI are now implemented and locally verified. The user chose full-audience support without the proposed ten-recipient cap, while keeping bulk delivery disabled until live gateway verification. Test destinations are account-global under WhatsApp; the admin defaults are `01700000001`, `01700000002` and `01700000003`. Gateway source inspection and mock tests are complete; real WhatsApp client verification and the opted-in pilot remain pending. See [operations and release gate](campaign-operations.md) for the shipped configuration and recovery behavior. The following sections preserve the original planning rationale.

Implementation update, 3 October 2026: Mandatory campaign tests, sender delivery verification and separate sending enablement have been removed at the owner’s request. A connected sender can launch, schedule or resume campaigns directly. Optional campaign test sends and account-global test destinations remain. Historical verification/enablement records no longer gate sends.

## Scope and current foundation

The application already has account-scoped leads, courier shipment history, contact exclusions, WhatsApp registration checks, business-owned gateway sessions, D1, a private R2 media bucket, and background queue processing. Campaigns, uploads, campaign delivery, and inbound event handling still need implementation.

Keep the current qualification rule: full deliveries from either courier and Pathao partial deliveries. A customer is one phone per business, even when both couriers have shipments. Store canonical country-code numbers internally and display local 11-digit numbers. Do not change courier import behavior as part of this feature.

First-release scope includes text, images, videos, ordered attachments, preview, test sends, immediate or scheduled campaigns, pause/resume/cancel, pacing, exclusions, opt-outs, and message-level results. Automated follow-ups, imo, revenue attribution, and experiments come later.

## Contact preferences and provider choice

Updated on 2 October 2026 to match the owner’s workflow: delivered leads can receive promotions unless marked **Do not contact** in Leads. There is no separate opt-in record, consent form, or permission import requirement. WhatsApp registration remains a reachability check. Explicit customer opt-outs set the same contact exclusion; **Allow contact** clears it for future campaign eligibility.

Recommend the official WhatsApp Business Platform for production marketing. It requires approved templates for business-initiated conversations and messages outside the customer service window. The existing WAHA integration is a linked-device gateway; throttling does not make it the official platform or guarantee protection from restrictions. Keep the sending adapter independent of campaign storage so a provider migration does not discard history. [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)

The near-term delivery design below targets the existing WAHA/WPP integration. Before enabling bulk delivery, verify the pinned gateway's actual capabilities. If an official provider is selected, its template approval, media-header constraints, variables, and message limits become launch requirements; do not assume an arbitrary multi-message bundle can be used outside its allowed conversation window.

## Campaign creation and lead selection

Use three steps: Audience, Message, Review and schedule. Put Campaigns in both account navigation menus, next to Leads. Admin campaigns use the admin's own leads and sender; businesses use their own records.

From Campaigns, preselect all qualifying WhatsApp-registered leads for that business. Users can narrow the audience with existing courier, search, and delivery-date filters, then optional delivery-count and parcel-value filters. From Leads, offer Create campaign with Selected leads or All matching leads. All matching leads is evaluated on the server across all result pages.

Membership is live while drafting. Scheduling or starting freezes the selected lead IDs, the reason each lead qualified, and the campaign content revision. Preserve non-sendable selected leads as skipped recipients for understandable reporting. New courier imports do not join an existing launch.

Run a bounded preflight before completing launch. Refresh unknown or stale registration results with the owner's session where possible; a proposed cache age is seven days. Do not run an unbounded registration scan in the browser or HTTP request. Unresolved checks become a distinct skipped reason rather than being reported as unregistered. A campaign that explicitly requests all WhatsApp leads must tell users when registration checks are incomplete.

Show one compact warning, for example: "18 selected leads have no WhatsApp account and will be skipped." Other reasons appear in the expandable recipient breakdown. Hide warnings when their counts are zero; no modal is required for routine skips.

| Condition | Recipient handling |
| --- | --- |
| WhatsApp registered and all other requirements pass | Ready |
| No WhatsApp account | Skip; show compact warning |
| Registration unresolved after preflight | Skip; identify as not verified |
| Do not contact or opted out | Skip across all campaigns |
| Contact cooldown active | Skip; show last contact date |
| Owner inactive or sender unavailable | Block launch or pause delivery |

Assign one primary skip reason using a stable precedence, with other applicable reasons available in detail. Counts must be mutually exclusive and add up to the selected total. Recheck mutable requirements immediately before every outgoing part. Enforce owner identity from the authenticated account and trusted job record, never from browser-provided ownership.

## Formatted message composer

Use a text editor with a compact toolbar that inserts WhatsApp syntax. Store plain text and formatting markers, not arbitrary HTML. Support bold `*text*`, italic `_text_`, strikethrough `~text~`, monospace, inline code, lists, quotes, paragraphs, emoji, and plain URLs. Start with the most useful controls visible and place less common ones in a menu. Verify formatting in text and captions on actual supported clients. [WhatsApp formatting guide](https://faq.whatsapp.com/539178204879377/)

Show an approximate chat preview and a separate raw-text view. Preserve Bangla, English, line breaks, and emoji. The preview must use an allowlisted renderer and safe text nodes so pasted text cannot inject HTML. Unsupported markup remains literal text or produces a concise validation warning.

Support `{{name}}` and `{{company}}` initially. Validate tokens and sample final output before launching, including missing names, long names, names containing formatting markers, and Bangla. Use a fallback greeting when a name is missing or unsuitable; never send unresolved variables. Personalization values must not introduce formatting controls or line breaks into the template. Check final rendered length, not only template length.

Example message source:

```text
হ্যালো {{name}},

*আপনার জন্য বিশেষ অফার 🎉*
আগের কেনাকাটার জন্য ধন্যবাদ। পরের অর্ডারে পাবেন *১০% ছাড়*।

- কোড: RETURN10
- মেয়াদ: ৭ অক্টোবর পর্যন্ত

অর্ডার করতে এই মেসেজে রিপ্লাই দিন।

_অফার মেসেজ বন্ধ করতে STOP লিখুন।_
```

Do not automatically invent an offer, discount, expiry, or customer purchase details. The example illustrates formatting only.

## Images and videos

Allow an image, a video, or an ordered mix of attachments with the formatted message. Proposed initial limits are three attachments, 5 MB per normalized image, 100 MB per normalized video, 4,000 Unicode code points for text, and a 1,024-code-point caption ceiling. Confirm these against the installed provider and lower them if needed; these are application ceilings, not claims about universal WhatsApp limits.

WAHA documents image/video sends with captions and WPP support. It recommends JPEG images and provides a video conversion endpoint. Verify the pinned image rather than assuming current website features exist in the installed build. [WAHA media documentation](https://waha.devlike.pro/docs/how-to/send-messages/)

Accept JPEG/PNG uploads, generate a JPEG delivery copy, flatten transparency against a previewed background, and strip unnecessary metadata. Accept MP4 video initially. Check content type, byte signature, container validity, dimensions, size, and compatibility rather than trusting the filename or browser MIME. Convert video once during preparation where needed, save the resulting MP4, and use that same prepared object for all recipients. A conversion failure leaves the asset invalid; do not silently substitute a file attachment or reconvert for every customer.

Files live in the existing private R2 bucket under owner-scoped generated keys. Metadata includes original name, actual MIME, bytes, checksum, preparation state, and prepared object key. Uploads use authenticated streaming endpoints with explicit byte limits. The current 4 KB JSON reader cannot handle binary uploads or long Bangla campaign JSON; add route-specific readers, with a proposed 32 KB campaign JSON ceiling, while retaining existing limits elsewhere.

Use authenticated URLs for in-app previews and short-lived signed download URLs for the gateway. Generate a new gateway URL just before sending, allowing enough time for fetching and retries. It may be fetched more than once during its short lifetime; never use a permanently public object or put session credentials in the URL. Support GET/HEAD and range requests for playback/download where necessary. Serve correct media types and redact URL tokens from logs. Do not permit arbitrary remote URLs in campaign content.

Clean abandoned uploads with a grace period. Assets referenced by a draft, scheduled, running, or retained campaign cannot be deleted underneath it. Restrict file deletion to its owner and preserve referenced prepared versions when content changes.

## Exact outgoing sequence

Compile the approved message and attachment order into explicit parts before sending. The review screen shows the same parts recipients will receive, including how many WhatsApp messages each customer will get.

- Text only: one text part.
- Media with text that fits the verified caption capability: the first media part carries the text as its caption; remaining media parts follow in order.
- Text too long for a caption: one complete text part followed by the ordered media parts.

Let the user choose a separate text part when preferred. Never truncate, repeat the full offer on every attachment, or assume multiple attachments arrive as one album. Each recipient has an immutable rendered copy of the approved parts and each part has its own send state and gateway message ID.

Changing content after launch creates a new draft or campaign copy. Pause and resume preserve the launched revision. Fixing a definitively failed asset part requires an explicit recovery revision for that part, preserving original content and history; successful parts are not resent.

## Sending pace and account protection

Start with these proposed operational defaults. They control application behavior and are not WhatsApp-approved safe rates.

| Setting | Proposed default |
| --- | --- |
| Concurrent outgoing requests per sender | One |
| Minimum interval after an outgoing request finishes | 6 seconds |
| Daily outgoing attempt budget per sender | 450 message parts |
| Campaign sending hours | 10:00–20:00 Asia/Dhaka |
| Cooldown between different campaigns for one lead | Seven days |
| Initial pilot | Delivered leads not marked Do not contact |

Pacing and budgets apply across campaigns and test sends for the same sender. Route other application-originated outgoing messages, including invitations, through a shared sender reservation so they cannot overlap; apply quiet hours and campaign contact cooldown only to campaign traffic. Existing invitation behavior and recovery semantics must continue to pass their tests.

Count every outgoing part and every potentially submitted retry against the budget. A text, image, and video sequence may cost three attempts per recipient. Before beginning a customer's sequence, reserve enough daily capacity for all planned parts. Do not start a new sequence that cannot fit the remaining daily budget. Keep a recipient sequence ordered and prevent other campaigns from claiming the same contact mid-sequence.

Track reserved and consumed budget separately so dispatching a reserved part does not charge it twice. A retry needs an additional slot. Release unused reservations on cancellation, retain consumed or uncertain attempt charges, and reconcile abandoned reservations during recovery. Budget dates follow Asia/Dhaka, not the gateway host's timezone. Finish a sequence only within allowed sending hours; if interrupted by the closing hour, resume its unsent parts in the next window after rechecking expiry and exclusions.

Do not compensate for downtime by bursting overdue messages. After reconnection, recheck expiry, the expected sender identity, and today's budget, then continue at the configured pace. Do not automatically increase speed based on a few successful sends. Pace registration checks separately and prioritize actual delivery over bulk background checks.

Pause the sender on restriction/authentication signals, gateway unavailability, or an uncertain in-flight result that could overlap a new request. Honor retry-after responses. A proposed circuit breaker also pauses after three consecutive definitive sending failures or three definitive failures in the most recent ten attempts; expose the reason and require review before continuing. Availability recovery may resume at the existing pace; restriction-related pauses require explicit operator review.

Handle STOP, UNSUBSCRIBE, and configured Bangla equivalents immediately; write an owner-scoped contact suppression and stop pending campaign parts. Provide manual Do not contact for requests that do not match those phrases. An ordinary reply stops the remaining promotional sequence for that lead and surfaces it for the business to handle. Do not claim WAHA can observe every recipient block or report; use only provider signals actually available.

Record an explicit opt-out as a contact exclusion. The existing Allow contact action clears that preference for future campaign eligibility. Apply emergency pauses across every campaign using the affected sender, including queued test sends.

## Background delivery and recovery

Use a dedicated campaign queue so media delivery does not occupy the lead-import queue. D1 is the source of truth for due work and send results. Queue messages identify the owner and work item; they do not contain binary media, secrets, rendered customer messages, or arbitrary sender identities.

Cloudflare Queues can redeliver work. Each send part therefore needs a stable identity and a guarded persisted state transition. Queue delivery order must not define attachment order. [Cloudflare delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

1. Materialize fixed launch membership on the server under a campaign revision, then prepare recipient parts in bounded batches. Make preparing visible and recoverable. Publish only after membership and content are fixed; a failed build cannot start partial delivery.
2. Commit due work and an outbox record together. Dispatch outbox work to the dedicated queue, with a persisted dispatch lease. A periodic sweep recovers committed work that was never enqueued.
3. Atomically reserve the sender, contact sequence, daily budget, and next eligible part using guarded D1 mutations. A read followed by an unguarded update is insufficient. Use tokens to fence stale workers and ensure every required reservation succeeded before an external request.
4. Check campaign state/revision, active owner, contact preference, available channel, expiry, sender identity, and pacing again immediately before dispatch. Cancellation or opt-out prevents subsequent parts, but cannot retract a request already submitted.
5. Persist an attempt as submitting before the gateway call. Bound gateway fetch time below the lease window, including media transfer time, and do not leave unresolved calls running while releasing the sender. Send using the verified chat ID from registration checks.
6. Persist the response and message ID. Advance only on a confirmed outcome. The next part becomes due after the configured interval; persist due timestamps and use delayed queue jobs or the recovery sweep, without sleeping inside a Worker.
7. Classify ambiguous timeout, gateway 5xx, worker death after dispatch, malformed success response, or failed result persistence as unconfirmed. Hold the remaining sequence and sender until the result and in-flight request are reconciled. Never automatically repeat that external send.
8. Retry only failures known to have occurred before submission or definitive retryable rejection, using bounded backoff. Resume at the failed part. Keep permanent failure, temporary deferral, and unconfirmed outcome separate.
9. An expired submitting lease becomes unconfirmed; it is not reset to pending. A stale worker cannot write over a newer resolution. Gateway events received before the API response are retained for later matching.
10. Use a dead-letter queue and visible recovery state for exhausted infrastructure jobs. A sweeper restores safe pending work but does not retry unconfirmed external sends.

Local idempotency prevents repeated application work, but D1 and the gateway do not share a transaction. Without verified provider idempotency, do not promise exactly-once external delivery. Operator actions to resolve an unconfirmed send must record who acted, their evidence, and any deliberate duplicate risk.

Keep the existing five-minute courier schedule and add a separate campaign recovery schedule, proposed at one minute. Launch and successive parts use direct queue dispatch for normal operation. Scheduled launch uses D1 due timestamps; do not depend on queue retention for long schedules. Keep sweeps bounded and index due work so a growing history does not require full-table scans.

Schedule fairly between active businesses and bound global gateway concurrency for the Mac's capacity. One unavailable sender must not block other owners. Within one sender, finish the current recipient sequence before selecting another campaign's recipient; use a stable campaign ordering and expose it in the UI.

## Storage and ownership

| Record | Main responsibility |
| --- | --- |
| `campaigns` | Owner, name, launched revision, sender identity, status, schedule, expiry, pacing, preparation progress |
| `campaign_parts` | Approved ordered text/media definitions and asset versions |
| `campaign_recipients` | Owner, campaign, lead, phone/name snapshot, selection evidence, primary skip reason, sequence progress |
| `campaign_messages` | Recipient/part identity, rendered payload snapshot, status, due time, lease, gateway ID, acknowledgement times |
| `campaign_send_attempts` | Attempt identity, submission lifecycle, failure classification, safe error, operator resolution |
| `campaign_assets` | Owner, private object keys, byte/type/checksum data, preparation state |
| `sender_dispatch_state` | Owner/sender identity, active attempt, lease, next allowed time, daily attempt budget, pause reason |
| `lead_contact_state` | Owner/lead, active sequence, last campaign contact, next allowed campaign time |
| `lead_marketing_permissions` | Historical records retained for compatibility; no longer used for campaign eligibility |
| `campaign_outbox` | Durable dispatch work and recovery leases |
| `whatsapp_events` | Authenticated deduplicated gateway events and unmatched message references |
| `campaign_actions` | Launch, pause, resume, cancel, opt-outs, and recovery audit trail |

Enforce unique campaign membership by owner/campaign/lead and unique parts by recipient/ordinal. Use composite owner foreign keys for all related records, including assets. Add indexes for due messages, active sender work, recent lead contact, campaign recipients, event matching, and outbox recovery. Derive authoritative counts from recipient/message states; any cached counters must reconcile to those records.

Do not hard-delete launched campaigns through normal UI. Archive them and retain message evidence for a defined retention period. Owner deletion needs an explicit retention/deletion policy that removes its media and personal data; do not leave snapshots outside account lifecycle handling.

## Events and reporting

Add a gateway webhook endpoint for message acknowledgements, incoming messages, and session changes. Verify the raw-body signature, reject unknown sessions, resolve ownership from stored session mapping, deduplicate event IDs, and limit body size. Preserve existing session configuration when adding webhook settings. WAHA documents HMAC support; confirm the installed build's exact configuration and payload. [WAHA events](https://waha.devlike.pro/docs/how-to/events/)

A gateway success means the send was accepted, not that the recipient received or read it. Store delivery/read timestamps separately and tolerate repeated or out-of-order acknowledgements without regressing state. Resolve LID/chat aliases through verified mappings; never guess a phone or owner. Attach quoted replies by original message ID. Leave ambiguous unquoted responses unattributed instead of crediting the wrong campaign.

Campaign detail shows recipients ready, queued, in progress, fully sent, partially sent, failed, unconfirmed, skipped, and cancelled. Report part-level delivered/read counts separately; do not count a partly sent bundle as fully sent. Define recipient delivery as all required parts receiving delivery acknowledgements. Unsupported or unavailable read receipts remain unknown. Completed means all sending work is terminal, even if later acknowledgements still arrive. No revenue or conversion claim is inferred from courier data.

Lead detail adds campaign history and last contact while retaining shipment history. Campaign controls show the next planned send time, today's remaining budget, and the reason a sender is waiting. Completion estimates account for total parts, intervals, daily budgets, and sending windows and are labeled estimates.

## Pages and API surface

Use shared Astro campaign components for `/admin/campaigns` and `/app/campaigns`, including new and detail routes. Desktop uses the available width for editor, attachment list, and preview. Mobile uses the same three-step flow with a reachable primary action, 44-pixel controls, accessible labels, keyboard focus, upload progress, and natural scrolling. Do not nest routine forms inside scrolling panels. Use concise warning rows and expandable technical details.

Proposed server endpoints:

- `GET/POST /api/campaigns`: list and create drafts.
- `GET/PATCH /api/campaigns/:id`: detail and edit a draft with revision checks.
- `POST /api/campaigns/:id/audience-preview`: server-side selection and exclusion counts.
- `POST /api/campaigns/:id/test`: test the exact compiled bundle to an explicitly chosen verified business-owned test destination.
- `POST /api/campaigns/:id/actions`: start, schedule, pause, resume, cancel, duplicate, archive, or resolve an unconfirmed part using explicit actions and request IDs.
- `GET /api/campaigns/:id/recipients`: filtered paginated results.
- `POST /api/campaign-assets`: authenticated streaming upload.
- `GET/DELETE /api/campaign-assets/:id`: owner preview or removal when unreferenced.
- `GET/HEAD /api/campaign-media/:token`: temporary gateway access to a specific prepared asset.
- `POST /api/whatsapp/events`: signed provider callbacks; it uses provider authentication, not browser sessions.

Reuse account authorization and same-origin checks for browser writes. Apply endpoint-specific payload limits, action idempotency, optimistic revision checks, pagination, and owner restrictions. Consult the project-required Astro routing, component, and styling guides before implementing pages and routes.

## Implementation milestones

| Milestone | Deliverable | Completion evidence |
| --- | --- | --- |
| 1. Verify provider | Installed version/capabilities, JPEG/MP4, captions, formatting, event signatures, identity mapping | Test bundle to a business-controlled destination; record limits and compatibility |
| 2. Persist campaigns | Additive migrations, drafts, contact preferences, audience compilation, fixed membership, owner checks | Cross-owner rejection, cross-courier deduplication, all-pages selection, consistent counts |
| 3. Prepare messages | Composer, personalization, uploads, prepared media, sequence compiler, previews, test sends | Bangla and formatting parity; malicious/oversized/wrong-format files rejected; real media playback verified |
| 4. Deliver reliably | Dedicated queue, outbox, reservations, due times, budgets, pause/cancel, circuit breaker | Concurrent/replayed jobs cannot double-send; interrupted bundles resume correctly; ambiguous requests remain held |
| 5. Process feedback | Signed webhooks, delivery/read events, opt-outs, responses, lead history | Duplicate/out-of-order/early events handled; opt-outs stop all pending offers; accurate partial results |
| 6. Validate release | Mobile/desktop QA, full project checks, isolated gateway tests, small opted-in pilot | No unintended production sends; pilot confirms formatting, media, pacing, and recovery before expanding |

Images, videos, opt-outs, and pacing are part of the first complete release. Do not release bulk campaigns with those controls deferred. Add automatic follow-up sequences only after reply matching and suppression are proven.

## Required failure and concurrency checks

Test two campaigns targeting the same lead/sender, duplicate launch clicks, duplicate queue delivery, stale leases, scheduled start repeated by Cron, pause during dispatch, cancellation, sender-number changes, deactivation, and contact exclusion after launch. Test a worker crash before dispatch, after gateway acceptance, and before saving the result. Verify that none silently resets an ambiguous send to pending.

Test image success followed by video rejection, an expired signed URL, expired offer during downtime, daily budget at a multi-part boundary, closing the browser, gateway restart, retry-after, restriction signals, and no catch-up burst. Test malformed/forged/duplicate webhook events, LID aliases, acknowledgements arriving before send results, opt-outs between parts, and unavailable receipts.

Test all matching leads beyond the current page, no-WhatsApp warnings, unresolved registration checks, unknown delivery dates, missing value evidence, personalization fallbacks, byte limits for Bangla JSON, upload cleanup, asset ownership, and prevention of deletion while a campaign still references media.

Use the existing isolated local fixture and mock gateway for automated tests. Real message tests only target the business-controlled test destination through an explicit test action; implementation verification must never send to imported leads automatically. Run the project's required checks, and validate viewport usability at mobile and desktop sizes before release.
