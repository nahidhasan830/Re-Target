# Re-Target

An invite-only outreach application for businesses in Bangladesh. Admins invite businesses through WhatsApp; invitees set a company name and password, then log in with their local phone number and password. There is no public signup.

## Current surface

Login opens Dashboard at `/admin` for admins and `/app` for businesses. Navigation follows Dashboard, Campaigns, Media, Leads, Courier, WhatsApp, Users (admin only), and Account. Users sends invitation links from the admin's connected WhatsApp, shows account setup and business connection status, and supports resending or revoking invitations. Links expire after 72 hours and can be used once; resending replaces the previous link.

The invitation form is always visible. At widths of at least 1101px and heights of at least 600px, Users uses 1:2 columns with both panels filling the available height. The invitation content is centered with an 80px envelope-plus icon; the table scrolls internally under sticky headings and keeps pagination below the rows. Smaller or shorter viewports stack the panels and scroll naturally. Pages display 25 records on desktop and five in compact layouts; API cursor batches remain up to 50 records. At 760px and below, the invitation card uses a centered 56px icon and title, 16px padding, and a phone field beside Send; secondary copy hides. Refresh becomes a 44px icon action, and single-page pagination hides.

At 1000px and below, each business record puts identity on the left and the account badge on the right, with a WhatsApp icon and status directly beneath the badge. There is no divider inside a record. A connected WhatsApp number hides only when it duplicates the account phone; a different number remains visible. Businesses awaiting account setup omit the redundant WhatsApp block while retaining delivery details and Resend/Revoke actions.

Invitees see their fixed invited phone number and set a company name and password. They then log in with that phone number and password and continue setup from Dashboard. Each business connects its own account-owned WhatsApp session through a QR code or pairing code; its business WhatsApp number may differ from its login number.

Account at `/admin/account` and `/app/account` lets admins and businesses save a company name and change their password through independent forms. Existing forms posted to the old dashboard roots receive a 307 redirect to Account, preserving their submission. The login phone remains visible, and the workspace shows the account role. Desktop places the forms in two equal columns. Mobile starts with Company details and a closed Password disclosure; opening Password hides the company form and offers a return to Company details. Password errors or a successful update keep the password form open. Each password field has an eye button, and both forms show validation, pending, success, and failure feedback.

Password changes verify the current password, require a different password of 10–128 characters with matching confirmation, and keep the current session signed in while invalidating older sessions. Attempts are limited to five per account and IP in 15 minutes. Admin company details are persisted; a saved admin password remains valid while the configured bootstrap credential is unchanged, and rotating that credential resets the saved override.

Pairing happens within Re-Target for both admins and businesses. The visible page automatically checks the session and refreshes the QR with a countdown to the next refresh. Connected, starting, failed, offline, and expired-login states must be clear. QR refresh is not a promise of the code's exact expiry time. Small mobile screens default to pairing code, hide the idle display placeholder, and put instructions in a closed How to link disclosure. Receiving a pairing code opens its instructions. Desktop exposes instructions alongside the display. A connected session shows its number and a Disconnect WhatsApp action.

Courier lets admins and businesses independently save and connect their own Pathao and Steadfast merchant accounts using email and password. Both credentials and sessions are encrypted and bound to the owner/provider. Save stores credentials; Connect verifies protected merchant access. Pathao uses rotating access/refresh tokens through the merchant login endpoint's refresh grant. Steadfast restores its Laravel session using the native remember-me cookie. Normal expiry never resubmits the merchant password. Refused or expired renewal credentials require explicit Reconnect. Credential changes invalidate sessions; blank saved passwords retain them. Atomic D1 leases and version checks protect concurrent renewal. Steadfast's production connection can use an optional authenticated Node transport when Worker egress is blocked.

Courier uses two equal desktop columns and stacked compact mobile forms, each with merchant email and password, independent connection status, inline validation, pending feedback, errors, and success feedback. Password fields have 44px eye buttons and saved passwords never appear in markup. Connect and Save share the mobile action row; Reconnect appears after a connection failure. Legacy Steadfast API-key-only records show Update login. Connecting a courier queues its background customer import.

Leads is available at `/admin/leads` and `/app/leads`, with a separate lead pool for each signed-in account, including the admin. Contacts are deduplicated by account and normalized phone. A contact appears with a delivered shipment or a confirmed Pathao partial delivery; pending, cancelled, unknown and Steadfast partial outcomes alone never qualify. Delivery count and courier sources derive from those included shipments; latest delivery uses confirmed full-delivery and qualifying Pathao partial-delivery event dates. Missing delivery dates remain unknown. Do not contact is a persistent preference stored separately from delivery qualification; excluded contacts stay in Leads.

The Leads table uses server-side name/phone search, courier, contact-preference and verified WhatsApp-account filters, known/unknown delivery dates and date ranges, sorting, and infinite scrolling in batches of 25 on mobile and 50 on desktop. Server requests remain bounded at 500 rows. Tabulator virtualizes a table filling the available viewport beneath the shared page header. Desktop supports column visibility, resizing and reordering. Customer name and local phone have separate visible columns on desktop and mobile; mobile reveals other evidence in the contact detail drawer. The View action remains visible while scrolling horizontally. Bulk preference updates are capped at 50 contacts.

Total and average parcel values are COD/collection amounts in BDT across the shipments included in the delivery count. Amounts are stored in integer poisha. If any included shipment lacks its amount, both aggregates stay unknown rather than reporting an incomplete total or average. New syncs collect values and backfill older Steadfast details once. Missing amounts remain unknown.

WhatsApp account checks run automatically in bounded background batches after a completed import, using the owner's connected session. Each subsequent import and a scheduled recovery sweep pick up missed checks, expired leases and upstream failures. Disconnected sessions leave numbers unchecked until the session is connected; failures never become a negative result. Verified account status, chat ID and check time are persisted independently of the do-not-contact preference. Only verified accounts show the WhatsApp icon. Filters distinguish Has WhatsApp, No WhatsApp and Not checked. Existing successful checks are reused. Campaigns consume this reachability evidence alongside the Do not contact preference. Lead export remains outside scope.

## Setup dashboard — 3 October 2026

Dashboard shows six linked rows and counts five required steps: saved company name, connected WhatsApp, one connected courier, an imported lead with a qualifying delivered shipment, and a launched or scheduled non-test campaign. Invitation onboarding usually completes the company-name step. Ready saved Media is optional and never blocks progress or the campaign next action. Checks derive from account-owned records through one database query; drafts and test campaigns do not complete setup. The next action opens the first unfinished required task, or Campaigns when all five are complete. Queued/running imports show Check import while no qualifying lead is available.

Progress refreshes manually or every 30 seconds while visible, and checks again when the page becomes visible. Refresh errors preserve existing checks; initial errors offer Refresh without inventing completion states. Desktop shows checklist and next action side by side; mobile shows next action first with natural scrolling and a 44px Refresh icon. All 16 synthetic captures at 1440×900, 1200×700, 390×844 and 320×640 report no horizontal overflow. Supplied browser checks cover refresh recovery, retained checks after failure, disconnected dependencies and admin navigation. Evidence, the ship verdict and documentation record are in `.impeccable/review/setup-dashboard/`.

## Product rules

- Localhost and the deployed app share one production D1 database, R2 bucket and queue producers. Do not create a separate local application database or persistent fixture; automated tests use ephemeral mocks.

- Accept and display Bangladeshi numbers as `01XXXXXXXXX`; use international representation for external services.
- The admin's session sends invitations and admin campaigns. Each invited business will connect its own session after account setup; its marketing number may differ from its login number.
- WAHA runs in Docker Desktop on the owner's Mac. Re-Target runs on Cloudflare and accesses WAHA through Tunnel and Access service authentication. Gateway credentials never reach the browser.
- Campaigns can target delivered leads unless marked Do not contact in Leads. No separate consent record or permission import is required. Allow contact clears that preference for future campaign eligibility.
- WhatsApp campaigns support full-audience selection, Leads contact preferences, fixed content and membership, ordered prepared media, schedules, explicit tests, opt-outs and audited recovery. Campaign sending is available with a connected WhatsApp account; test sends are optional. Instant begins sending as soon as preparation is complete, at any hour; scheduled delivery uses the chosen date and time. Campaigns have no sending cutoff.
- Each account manages up to 10 global campaign test destinations under WhatsApp. Admin defaults are `01686865438`, `01628328074` and `01785616801`; tests use the owning account’s connected sender.
- Pathao and Steadfast customer imports are available. imo and the undefined “other” channel remain future scope. See [campaign operations](docs/campaign-operations.md).

WhatsApp uses two desktop columns: Connection on the left and optional Test destinations on the right. At smaller widths they stack, and the connected mobile state omits the redundant center display. Up to 10 test numbers are saved per account. Campaigns require no delivered test, verification or separate sending enablement. The sender recovery UI remains removed.

## Interface commitments

Use a modern dashboard shell with a desktop sidebar and a menu button opening a left-side drawer on mobile, cream workspace, white panels, green active states, system typography, and restrained forms. Use the available desktop width and aim for a single screen where practical through compact spacing, responsive columns, pagination, and disclosure. Keep primary controls visible and permit natural page scrolling on small screens, at zoom, or with long content; routine forms should not have nested scrolling.

The shared admin and business dashboard shell keeps Log out at the sidebar bottom, without the account profile or phone block, and has no platform footer.

Keep copy concise, accessible labels and keyboard interaction intact, touch targets at least 44px, and verify mobile and desktop. Label the navigation item and pages WhatsApp. Preserve the existing login and invitation setup surfaces; login needs no extra access notice or phone-format explanation beyond its placeholder. The pairing QR needs a plain white surface with its full quiet zone visible.


Shared dashboard headers show the current page title instead of a workspace label. Counts, concise page context and primary actions sit alongside the title. Leads keeps courier details in a header popover. Dropdowns reserve 40px on the arrow side, with the arrow inset 12px, throughout the dashboard. Headers, table footers and primary controls stay visible within practical viewport sizes; short screens and zoom may scroll naturally.


Leads toolbar cleanup (2 October 2026): Refresh is a labeled 44px icon beside Search. Columns uses a labeled icon in the filter toolbar; Reset filters appears only when filters are active. The selection count and contact-preference actions appear in a contextual strip only while rows are selected, removing the idle action row. Desktop and mobile interaction/viewport evidence is in `.impeccable/review/leads-toolbar/`.


## Contact and header refinement — 2 October 2026

Dashboard headers have no subtitles or role badge. The role badge sits beneath the Re-Target logo in the shared sidebar and mobile drawer. Leads shows Pathao (count) · Steadfast (count) inline, using all qualifying contacts per source independent of pagination and filters; contacts with both sources count in each. Table headers and values are centered. Total Parcels shows one count including qualifying Pathao partials, without a separate partial label. COD columns are Total Value (BDT) and Average Value (BDT). Contact replaces the WhatsApp column name; its filter offers All, WhatsApp, disabled IMO, and None. None matches a verified negative WhatsApp check; unchecked contacts remain Not checked, and IMO detection is not implemented.

Do not contact and Allow contact are 44px icon actions beside search, always present and disabled until selection is available. Sync now keeps its label and shows a spinner throughout request, queued and running states; it disables until all imports finish. Import errors remain visible. Courier omits View leads and the duplicate saved-password helper. Users and invitation setup omit redundant introductions; WhatsApp retains connected phone information and linking instructions without a subtitle.

Verified with synthetic data and a mock gateway in an isolated fixture at 1440×900, 390×844, and 320×640. Typecheck and build passed; 32 relevant regression tests passed. Evidence is in .impeccable/review/leads-contact-refinement/.

Pathao Latest delivery comes from the explicit Delivered. event in its parcel activity history, interpreted in Bangladesh time. Sync backfills existing history in batches of five, caches successful checks, and rechecks when the source status timestamp changes. Missing confirmed delivery events keep an unknown latest delivery. Pathao partial histories use the explicit Partially delivered. event.

Total Value and Average Value sort largest first on the first header click or keyboard activation, then alternate with smallest first.


## Campaign editor layout — 2 October 2026

Campaign creation places campaign name at the top of a wider left filter panel and the audience table on the right. Each filter occupies its own row. Search, Courier, Contact Channel, minimum deliveries and minimum value update results live; text and numeric edits debounce for 300ms, and stale responses cannot replace newer results. Contact Channel offers WhatsApp, disabled IMO and All. Delivery-date controls, recipient breakdown, the filter accordion and the redundant ready/matching count are removed.

The audience reuses the Leads DataTable shell, Tabulator styling and infinite loader. Desktop shows Name, Phone, Contact, Deliveries and Total Value (BDT); mobile shows Name and Phone. Scrolling loads additional batches, with Load more and Retry as accessible fallbacks. All matching leads remain included regardless of which batches are visible. Filter changes restart the list. Continuing requests a fresh audience for the current filters.

The connected three-step indicator is centered above the workspace. Active steps use the green marker; earlier steps show a check. Campaigns navigation sits at the right of the shared header. Draft state and campaign actions stay in the bottom action bar. Standard desktop viewports fit without page overflow; mobile stacks always-visible filters above the table and permits natural scrolling. Audience filters is a plain heading and never collapses the controls. Initial skeletons follow the same layout.

Verified at 1440×900, 1200×700, 390×844 and 320×640 with synthetic requests. Live filtering, infinite loading, append failure/retry, stale-response suppression, empty results and message-step navigation passed. No horizontal overflow. Astro check and build passed; 52 campaign, infinite-source and loading tests passed using in-memory mocks. Evidence: `.impeccable/review/campaign-audience-infinite/`.


## Campaign cards and editor header — 2 October 2026

Campaigns displays responsive cards with name, status, lead count and created/scheduled date. Drafts show current matching leads; launched campaigns show fixed recipients. Draft Edit opens the existing composer. Edit copy duplicates a launched campaign into a new draft. Delete requires an inline confirmation and is available for draft, completed, cancelled and archived campaigns. The endpoint checks ownership and revision, prevents deletion during active or unconfirmed sends, and cascades campaign history. Active campaigns must be cancelled first. Existing archive retention and unreferenced-media cleanup continue to apply.

New campaign and campaign detail use a 44px back-arrow link immediately before the header title. Campaign detail puts the campaign name, status/revision and Duplicate/Archive or lifecycle controls in the header. Step labels remain visible. Saving a draft updates the header name and revision. Desktop draft editing fills the available height with the audience table stretching above the bottom action bar; mobile and short screens scroll naturally.

Verified with in-memory synthetic responses at 1440×900, 1200×700, 390×844 and 320×640. No horizontal overflow; desktop audience editing fits viewport height. Deletion confirmation, cancellation, failed-delete retry, archive filtering and saved-header updates passed. Campaign/loading tests: 46 passed. Evidence: `.impeccable/review/campaign-cards/`.

## Media library — 2 October 2026

Media gives each account a separate image and video library with upload progress, preparation feedback, filename search, type filters, pagination and native preview/delete dialogs. JPEG and PNG uploads allow up to 5 MB; MP4 allows up to 100 MB. Saved ready files survive unused-media cleanup. Files referenced by campaign content or message history cannot be deleted; preparation also blocks deletion. Campaigns choose up to three ready files in sequence from the library picker, preserve selection across filters and pages, and apply changes only on confirmation. The incumbent cream/forest green dashboard remains intact. Synthetic interaction checks passed at 1440×900, 390×844 and 320×640 with no horizontal overflow; mobile uses natural scrolling. Evidence: `.impeccable/review/media-library/`.


Campaign sending limits (3 October 2026): The shared sender allowance is 450 outgoing attempts per Dhaka day, with at least six seconds after a send request finishes before the next campaign message. Tests, invitations and failed outgoing attempts share that allowance. Provider-requested waits may be longer. The existing seven-day customer cooldown and full-sequence budget reservation remain in force. Review explains these rules in four visible bullets and estimates days from the actual compiled message count.


Media layout (3 October 2026): Media uses a 1:2 desktop layout above 1100px, with a centered upload panel and a larger library panel. Both panels fill the available desktop height. The library displays six files in three columns from 1360px, four in two columns on smaller desktop widths, and six in three columns on tablet. Mobile stacks a compact upload panel above a two-column, four-file library with natural page scrolling. Short desktop windows use smaller thumbnails; preview and delete actions retain 44px touch targets, with icon-only preview on mobile. Image-background controls are removed, and uploads use the service's default image preparation. Existing search, filtering, upload progress, preparation feedback, previews, deletion and pagination remain.

Verified with synthetic in-memory browser responses at 1440×900, 1200×700, 900×800, 390×844 and 320×640. No horizontal overflow; desktop fits both tested viewport heights. Upload, invalid-file recovery, search, type filters, pagination, preview, empty results, refresh recovery, failed/successful deletion and focus restoration passed. Astro check and build passed. Builder review and evidence: `.impeccable/review/media-layout/`. No shipping raster assets or new design tokens were introduced.
