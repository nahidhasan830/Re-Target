---
name: Re-Target
description: Modern, restrained outreach dashboard with a cream and forest green identity.
colors:
  paper: "#f6f5f0"
  surface: "#fff"
  ink: "#202a26"
  muted: "#52605a"
  green: "#17603d"
  green-soft: "#e7f0e9"
  dashboard-line: "#dbe0da"
  auth-line: "#b9c2b9"
  error: "#a12b29"
  error-surface: "#f7e7e2"
  green-hover: "#124b30"
  green-active: "#103f29"
  selection: "#c8dfc9"
typography:
  auth-headline:
    fontFamily: "system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 7vw, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-.035em"
  headline:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.03em"
  headline-mobile:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.03em"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    letterSpacing: "-.02em"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: ".9375rem"
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: ".875rem"
    fontWeight: 600
    lineHeight: 1.6
  caption:
    fontFamily: "system-ui, sans-serif"
    fontSize: ".75rem"
    lineHeight: 1.6
rounded:
  badge: "6px"
  control: "8px"
  qr: "12px"
  panel: "16px"
spacing:
  small: "8px"
  compact: "12px"
  medium: "16px"
  roomy: "20px"
  section: "24px"
  panel: "28px"
  wide: "32px"
  navigation: "44px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-primary-active:
    backgroundColor: "{colors.green-active}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.green-soft}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
    height: "52px"
  input-account:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "48px"
  navigation-active:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  connection-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
    padding: "6px 10px"
  connection-chip-connected:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  account-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "24px"
  account-panel-mobile:
    padding: "20px"
  workspace-main:
    padding: "28px 32px"
    width: "100%"
  workspace-main-mobile:
    padding: "20px"
  workspace-topbar:
    backgroundColor: "{colors.surface}"
    padding: "0 32px"
    height: "64px"
  workspace-topbar-mobile:
    padding: "0 20px"
  workspace-main-users:
    height: "calc(100dvh - 64px)"
  users-invite-panel:
    padding: "24px"
  users-invite-panel-compact:
    padding: "20px"
  users-invite-panel-mobile:
    padding: "16px"
  users-list-header:
    padding: "20px"
  users-list-header-mobile:
    padding: "16px 20px"
  users-list-pagination:
    padding: "12px 20px"
  pairing-header:
    padding: "20px 24px"
  pairing-header-mobile:
    padding: "20px"
  form-error:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
---

# Design System: Re-Target

## Overview

**Creative North Star: "Modern, restrained dashboard"**

Re-Target uses a modern, restrained dashboard within its established cream and forest green identity. White navigation and panels organize the cream workspace; soft green identifies active navigation and successful connections. System typography, fine dividers, and outline SVG icons keep the interface practical and quiet.

Authentication retains its narrower incumbent composition, larger heading, and stronger input border. Dashboard measurements apply to workspace surfaces rather than replacing the login styling.

The workspace uses the available desktop width, compact spacing, responsive columns, pagination, and progressive disclosure to keep the current task and its controls visible. A single viewport is the target where practical; readable content and comfortable controls take priority when small screens, zoom, or long content need natural page scrolling.

**Key Characteristics:**

- Cream workspace with white panels and navigation.
- Forest green actions and soft green active states.
- Flat surfaces, fine dividers, and gently rounded controls.
- Desktop sidebar and a mobile navigation drawer.
- Full desktop workspace width with compact, responsive task layouts.

## Colors

Cream, forest green, and white form the shared identity; dashboard and authentication dividers deliberately differ.

### Primary
- **Forest green** (`green`): primary actions, links, brand mark, focus outlines, and connected states.
- **Soft green** (`green-soft`): active navigation, connected badges, and control hover states.
- **Action green variants** (`green-hover`, `green-active`): primary button pointer states; the active variant appears in the dashboard.

### Neutral
- **Cream paper** (`paper`): page workspace and quiet badge backgrounds.
- **White surface** (`surface`): panels, navigation, inputs, and QR backing.
- **Dark ink** (`ink`): headings, primary content, and numeric values.
- **Muted ink** (`muted`): supporting copy, inactive navigation, labels, and caption text.
- **Dashboard divider** (`dashboard-line`): soft panel, navigation, and row divisions.
- **Authentication divider** (`auth-line`): the stronger login input stroke.
- **Selection green** (`selection`): selected text background in both layouts.

### Semantic feedback
Error text uses `error`; form alerts use `error-surface`. These are feedback treatments rather than a second brand accent.

**The Surface Scope Rule.** Keep the dashboard’s softer divider scoped to dashboard surfaces; authentication keeps its incumbent input border.

## Typography

**Display and Body Font:** System UI with sans-serif fallback. The system uses the user’s device typography throughout; there is no separate display family.

### Hierarchy
- **Authentication headline:** `auth-headline`; the login title is larger than dashboard titles.
- **Dashboard headline:** `headline`, reducing to `headline-mobile` at the shell’s mobile breakpoint.
- **Panel title:** `title`; Account, pairing, and Users panel titles have an explicit line-height (1.4).
- **Body:** `body` on dashboard surfaces. Authentication inherits browser-default body sizing with line-height (1.6). Dashboard introductory copy is limited to (65ch); pairing description to (52ch).
- **Control and navigation text:** dashboard actions use the label role; navigation uses weight (550), increasing to (650) when active. Authentication labels use (.9rem) and weight (600); login inputs use (1rem).
- **Caption:** `caption` for badges, business count, table headings and details, and QR countdown. The workspace bar, business-list range, and secondary invitation copy use (.8125rem).

Phone values, pairing codes, countdowns, and business-list ranges use tabular numerals. Brand text uses (1.25rem), weight (650), and letter-spacing (-.03em).

## Layout

Desktop dashboard navigation is fixed to the left at (240px). The workspace offsets by the same width. Its white top bar is (64px) high. Main content fills the remaining width with padding from `workspace-main`; the workspace has no maximum-width cap. Account, Users, WhatsApp, and Courier use the available workspace width. The shared admin and business shell has no platform footer; its sidebar bottom retains Log out without a profile or phone block.

At (760px) and below, a (44 × 44px) menu button opens the sidebar in a native modal dialog from the left. The drawer is at most (320px) wide, leaves at least (48px) of backdrop visible, and uses the full dynamic viewport height with safe-area padding. Navigation and logout remain available in the drawer. Main and top-bar padding follow their mobile tokens; the dashboard heading reduces to the mobile role. The top bar stays (64px) high.

Account starts with two equal columns separated by the `section` gap. At (760px) and below, it becomes one column with a `medium` gap and the password task uses progressive disclosure. Account panel padding follows the account tokens; desktop viewports at most (740px) high also use the compact panel padding. The Account heading hides its introductory copy on mobile and keeps the login phone beside the title.

Courier extends the same form geometry with two equal desktop columns, the `section` gap, and stretched panels whose independent actions align at the bottom. Panels use the account panel padding tokens. At (760px) and below, forms stack with the `medium` gap, both remain visible, and actions fill their form width. Desktop viewports at most (740px) high use compact panel padding, a smaller field gap (`compact`), and reduced heading and form spacing. Forms use natural page scrolling when their content exceeds the viewport.

Pairing begins with two equal columns, a display minimum height (360px), and interior padding from `section`. Between (761px) and (1000px), its interiors and QR frame become more compact without stacking. At (760px) and below, display and instructions stack; an unconnected idle placeholder is hidden, and the page introduction is omitted. At (480px) and below, the connection header stacks and the QR frame padding reduces from `medium` to `compact`. Connected state uses one display region and hides linking instructions.

Users keeps the invitation form visible at every size, with no disclosure. At widths of at least (1101px) and heights of at least (600px), main uses `workspace-main-users` with normal `workspace-main` padding, leaving a bounded content area beneath the top bar. The page and grid flex to fill that area. The grid uses `minmax(280px, 1fr) minmax(0, 2fr)` and the `section` gap; both panels stretch to the available height. The invitation content is safely centered within its panel and bounded to (360px), with an envelope-plus outline icon (80 × 80px), centered heading and supporting copy. The table row region scrolls internally with sticky headings; pagination stays outside that scroller.

Below that width or height, panels stack and the row region returns to natural page scrolling; the invitation icon is (56 × 56px). At (1000px) and below, the table becomes compact business entries. At (760px) and below, the invitation card uses `users-invite-panel-mobile`, a centered icon and title, and one row containing the phone field and Send action. Secondary introduction, description, and invitation note hide; page and grid gaps use `medium`. Pages show 25 records in the bounded desktop layout and five in compact layouts, while the API continues to fetch cursor batches of up to 50.

**The Visible Task Rule.** Use available desktop width, responsive columns, pagination, and disclosure to keep primary controls visible. Allow natural page scrolling when content, zoom, or a smaller viewport needs it; avoid nested scrolling for routine forms.

Authentication stays centered at `min(420px, calc(100% - 48px))`, with vertical padding `clamp(36px, 9vh, 100px) 0 64px`. Its header uses `28px clamp(24px, 5vw, 72px)`, changing to (24px) at (420px) and below.

## Elevation & Depth

The inspected surfaces have no box shadows. White panels and navigation sit against cream paper, separated by single-pixel strokes. The pairing display adds a very light neutral background (`#fafbf9`) behind a plain white QR frame; this component-local fill is not a general palette token.

**The Flat Panel Rule.** Use tonal surfaces and fine dividers for dashboard depth; keep panels free of decorative elevation.

## Shapes

Panels have gently rounded corners (`panel`); buttons and fields use `control`; compact badges use `badge`. QR frames use `qr`. The login password toggle uses (5px), dashboard password toggles use `badge`, and numbered steps and status dots are circular. Outlines are one pixel except the shared keyboard focus ring.

## Components

### Buttons

Primary actions are forest green with white text, control corners, and padding (12px 20px). Dashboard actions are at least (48px) high; login actions at least (50px). Hover uses `green-hover`; dashboard press uses `green-active`. Disabled actions reduce opacity to (.7) and use a wait cursor. Dashboard primary background transitions use (160ms ease-out). All surfaces share a green keyboard outline (2px), offset (4px).

Secondary actions such as Refresh, pagination, and Disconnect WhatsApp are white with a dashboard divider stroke, minimum height (44px), and padding from `button-secondary`. They turn soft green on hover. Users keeps Refresh in the business-list header; at (760px) and below it uses a (44 × 44px) icon target with its text visually hidden and accessible name retained. Account and Courier form actions use their content width on desktop and fill the form on mobile. Sidebar logout is transparent at rest and uses the paper background on hover.

### Chips

Connection badges combine a text label with a circular current-color dot (6px). Neutral states use paper and muted text; Connected uses soft green and forest green. Badge corners and padding are defined by the connection chip tokens. Account role and Courier credential status use the same compact color family with padding (4px 10px). Courier shows Not set up or Saved as text without a connection dot.

### Cards / Containers

Account, Users, pairing, and Courier panels use white, a single dashboard-divider border, and panel corners. The Users business panel and pairing panels clip content to their outer corners. Account and Courier use the account panel padding tokens. The Users invitation panel uses `users-invite-panel`, reducing to `users-invite-panel-compact` when panels stack and `users-invite-panel-mobile` at (760px) and below. Its full content is centered in the bounded desktop panel; the concise mobile card centers its icon and title above the phone-and-Send row. The business-list header uses `users-list-header`, changing to `users-list-header-mobile` at (760px) and below. Pairing headers retain the pairing-header tokens. Account fields and actions are grouped within each independent form.

### Inputs / Fields

Login fields are white, (52px) high, with control corners, authentication strokes, and padding (12px 14px). Hover darkens the border to muted ink; invalid fields use the error border. Focus uses the shared green outline. Labels remain visible. Validation copy sits below fields; form-level errors sit on the warm error surface.

The password visibility button has a (44 × 44px) target and inline eye/eye-off SVGs (20px). Its pressed state switches the icon and accessible name. The field reserves right padding (56px). A soft component-local hover fill (`#eaf1e8`) is preserved. Enter submits the login form from either field.

Dashboard account fields use `input-account` with the softer dashboard stroke. Labels are (.875rem), weight (600), with a (6px) gap before the field. Current, new, and confirmation password fields use the same eye-button geometry; their hover fill is `green-soft`. Field errors remain beside the relevant field, form errors use a warm alert surface, and pending and success feedback sit with the action. Validation focuses the first invalid field. Password visibility buttons are enhancements; the underlying forms still submit without JavaScript.

### Navigation

Navigation rows use outline SVG icons (20px), medium weight, control corners, and minimum height (48px). Resting labels are muted. Hover uses paper with ink text; `aria-current="page"` uses soft green, forest green, and heavier text. Mobile uses the same vertical rows inside the drawer. Its menu and close buttons use outline icons (22px) within (44 × 44px) targets. The drawer dims the background, locks page scrolling, cycles keyboard focus, and closes with its close button, Escape, a backdrop click, or navigation. Closing restores focus to the menu button; resizing to desktop returns the shared sidebar to the page. The entrance slides in over (220ms), disabled for reduced motion. The skip link becomes visible on focus.

### WhatsApp pairing

The QR image is rendered up to (280 × 280px) within a white frame with padding; its quiet zone remains visible. The refresh caption is centered below it. The fallback display uses an outline phone/check SVG and concise text.

The method selector offers Scan QR code and Use pairing code in a cream bordered group with white selected buttons. Small mobile screens (600px and below) initially select pairing code. Desktop exposes the linking steps; mobile puts them behind a How to link disclosure that opens when a code is ready. The code display uses large tabular digits on a white bordered surface.

States are Checking, Not connected, Waiting to link, Connecting, Connected, Connection failed, and Unavailable. Starting disables the action; successful connection hides the linking instructions and offers Disconnect WhatsApp. Failed or unavailable states offer Try again. Errors use a visible alert, success uses a status announcement, and expired authentication redirects to login. Hiding the page removes the current QR and pauses refresh until visible again. The countdown describes the next refresh, not guaranteed expiry.

### Account settings

Company details and Password are independent tasks. Desktop exposes both forms. Mobile initially closes Password unless that form has an error or success message; opening it hides Company details and changes its summary action to Company details for returning. Summaries have at least (44px) height, concise labels, and an outline chevron. Company and password actions have separate pending labels and feedback.

### Courier credentials

Provider forms use the incumbent dashboard fields and eye-button geometry. Labels and inline validation remain visible; pending and success messages sit beside the independent save actions. Saved secrets use empty replacement fields with a concise preservation hint. Credential status uses text with the neutral or soft-green badge treatment and makes no connection claim.

### Business list

Rows show business identity, account status, WhatsApp status, and applicable invitation actions. Compact entries at (1000px) and below group identity on the left and the account badge on the right, with a right-aligned WhatsApp status line directly beneath the badge. Its outline icon and status share one flex line, vertically centered with a (5px) gap. A connected phone appears separately below that line, so it cannot change the icon/status alignment. Fine dividers separate records; there is no internal record divider. A connected WhatsApp phone hides in compact entries only when it equals the account phone; a different phone remains visible. Nonaccepted entries omit the redundant awaiting-account WhatsApp block but keep delivery details and Resend/Revoke actions with comfortable targets. The focusable row region uses a stable scrollbar gutter in the bounded desktop layout, with sticky table headings. The pagination bar uses `users-list-pagination`, shows the current range, disables unavailable directions, and uses tabular numerals. It is a sibling of the row scroller, so it stays anchored below scrolling rows. A viewport change switches between 25-record desktop pages and five-record compact pages while preserving the current record position; page changes reset row scrolling. At (760px) and below, pagination hides when the list fits one page and no cursor remains. Empty-state copy points to the always-visible invitation form.

## Do's and Don'ts

### Do:

- **Do** use the dashboard divider on dashboard panels and the stronger authentication divider on login fields.
- **Do** keep visible labels, keyboard focus, and action targets at least 44 × 44 pixels.
- **Do** use inline outline SVG icons for interface actions.
- **Do** show the full QR quiet zone on a plain white surface.
- **Do** keep local Bangladeshi phone numbers and countdowns readable with tabular numerals where implemented.
- **Do** use available workspace width and keep primary controls visible with responsive columns, pagination, and disclosure.
- **Do** allow natural page scrolling for small viewports, zoom, and long content.
- **Do** label the navigation item and pages WhatsApp.

### Don't:

- **Don’t** extend dashboard width and heading sizes to the narrower login composition.
- **Don’t** add decorative elevation to these flat panels.
- **Don’t** replace text connection states with color alone.
- **Don’t** treat the next-refresh countdown as the QR code’s exact expiry time.
- **Don’t** add nested scrolling to routine forms or redundant instructions to compact task views.


Source evidence: `src/layouts/DashboardLayout.astro`, `src/layouts/AuthLayout.astro`, `src/pages/index.astro`, `src/components/AccountSettings.astro`, `src/pages/admin.astro`, `src/pages/app/index.astro`, `src/pages/admin/users.astro`, and `src/components/WhatsAppPairing.astro`. The earlier Users, shared sidebar, and footer version was reviewed across ten desktop and mobile captures in `.impeccable/review/users-redesign/`; those captures remain historical evidence. The earlier centered invitation and compact-record refinements received disposition: ship, with no material fixes, after review of nine final captures in `.impeccable/review/users-refinement/`; that review remains historical for the subsequent alignment correction. The current compact WhatsApp icon/status alignment correction received disposition: ship, with no material fixes, after review of all four required captures in `.impeccable/review/whatsapp-alignment/review.md`; its `validation.json` records builder measurements. Earlier Account and WhatsApp captures in `.impeccable/review/` remain historical evidence; this pass did not re-review those surfaces. Product-level commitments are recorded in `PRODUCT.md`; the admin composition remains in `.impeccable/surfaces/admin.md`. No shipping raster assets are part of this system; the QR is runtime content.

Courier extension evidence: `src/components/CourierSettings.astro`, `src/pages/app/courier.astro`, `src/pages/admin/courier.astro`, and the shared dashboard layout were compared with the incumbent Account form and tokens. All eight supplied captures in `.impeccable/review/courier/` were checked; independent review in `review.md` received disposition: ship, with no material fixes. `validation.json` records builder-reported build, test, sizing, and interaction checks. `detector.json` has no primary findings; its four typography advisories match existing Account/shell literals, so this extension neither adds type-ramp tokens nor repairs that pre-existing recording drift. No raster assets ship.


## Dashboard header and Leads table update — 2 October 2026

The shared topbar now owns the single page h1 for Leads, Users, WhatsApp, Courier and Account. It keeps its 64px minimum height, an ink title at the existing 1.25rem size, inline metadata and primary actions. Descriptions and the role badge hide on mobile to keep the navigation, title and actions on one line. Leads count, contact-preference summary and courier-status disclosure live here; the table starts 12px below the header and fills the remaining viewport, with loaded/total counts and a Load more fallback outside the row scroller. No new palette or typography world is introduced.

All dashboard native dropdowns use a 16px outline chevron inset 12px from the right, with 40px reserved right padding. Table rows are 52px high; selection and View retain 44px targets. Headers wrap where necessary. Customer and Phone remain separate on mobile, with other evidence in the detail drawer; View is frozen at the right edge. Verified WhatsApp accounts use the existing outline WhatsApp icon, while absent and unchecked accounts use explicit text. Parcel values are right-aligned with two decimal places; missing COD values show Unknown.

The current screenshots and local verification are recorded in `.impeccable/review/leads-table-update/`. Historical review verdicts elsewhere in this file predate this change.


Leads toolbar cleanup (2 October 2026): Refresh is a labeled 44px icon beside Search. Columns uses a labeled icon in the filter toolbar; Reset filters appears only when filters are active. The selection count and contact-preference actions appear in a contextual strip only while rows are selected, removing the idle action row. Desktop and mobile interaction/viewport evidence is in `.impeccable/review/leads-toolbar/`.


## Contact and header refinement — 2 October 2026

Dashboard headers have no subtitles or role badge. The role badge sits beneath the Re-Target logo in the shared sidebar and mobile drawer. Leads shows Pathao (count) · Steadfast (count) inline, using all qualifying contacts per source independent of pagination and filters; contacts with both sources count in each. Table headers and values are centered. Total Parcels shows one count including qualifying Pathao partials, without a separate partial label. COD columns are Total Value (BDT) and Average Value (BDT). Contact replaces the WhatsApp column name; its filter offers All, WhatsApp, disabled IMO, and None. None matches a verified negative WhatsApp check; unchecked contacts remain Not checked, and IMO detection is not implemented.

Do not contact and Allow contact are 44px icon actions beside search, always present and disabled until selection is available. Sync now keeps its label and shows a spinner throughout request, queued and running states; it disables until all imports finish. Import errors remain visible. Courier omits View leads and the duplicate saved-password helper. Users and invitation setup omit redundant introductions; WhatsApp retains connected phone information and linking instructions without a subtitle.

Verified with synthetic data and a mock gateway in an isolated fixture at 1440×900, 390×844, and 320×640. Typecheck and build passed; 32 relevant regression tests passed. Evidence is in .impeccable/review/leads-contact-refinement/.


## Shared table and infinite scrolling — 2 October 2026

Leads uses the shared `DataTable.astro` shell and `createDataTable` client controller. The bounded virtualized row region loads subsequent server batches as the user approaches its end. The footer shows loaded/filtered-total counts and a 44px Load more fallback, becoming Retry after a failed batch. Completed results hide that action. Filter and sort changes reset the list; appends preserve selection, and refreshes preserve the loaded range and scroll position. Errors retain existing rows. Lead-specific filters, courier metadata, column visibility, bulk contact preferences and the detail drawer remain in Leads. Shared palette and table geometry are preserved. Usage is documented in `docs/data-table.md`.


## Campaign contact preferences — 2 October 2026

Campaigns no longer shows a consent import or file-format section. The Leads detail drawer keeps its Do not contact checkbox and campaign/shipment history, with no separate permission form. Campaign eligibility follows that contact preference; imported leads require no consent record. The existing paper/white/green dashboard styling is preserved. Desktop and mobile checks are recorded in `.impeccable/review/contact-preferences/`; earlier consent-import captures are historical.

Campaign list states (2 October 2026): The list panel fills the remaining workspace height on desktop and mobile. Initial loading uses six placeholders matching the name, audience, status and date columns; mobile moves dates below the row identity. Short viewports clip decorative placeholders without adding page scrolling. Motion respects reduced-motion preferences. Empty results center the campaign icon, title and Create campaign action in the full-height panel; archived results omit that action. Refresh retains the current result, disables request controls, and exposes loading through a live status and aria-busy. Its 18px refresh icon switches to a spinning progress icon during requests while keeping the Refresh label and button width stable; reduced motion shows a static progress icon. Initial failure offers Try again. Desktop and mobile evidence is in `.impeccable/review/campaign-list-states/`.

Application loading states (2 October 2026): Shared skeletons follow each destination's structure: Leads table, campaign list, Users invitation and business list, Account and Courier fields, WhatsApp connection and test numbers, campaign audience editor, campaign details, and authentication fields. Native same-window links display the destination skeleton while the browser requests the page. Modified clicks, downloads, external links and same-page anchors retain native behavior. Back navigation, cancelled unsaved-change prompts and stalled navigation restore the existing content. Content behind a navigation placeholder is inert, with a live loading announcement and aria-busy.

Client requests also use section-specific skeletons for initial Leads rows, WhatsApp connection checks, test numbers, audience samples, campaign details and recipients, and shipment history. Leads placeholders match the current visible columns and widths. Refreshes and appended results retain existing content. Loading skeletons clear on failure; test-number settings stay unsavable until loaded and offer Retry loading numbers, while campaign details offer Try again. Users retains server-rendered business details while initial WhatsApp status checks show small inline placeholders. Account, Courier, login and invitation submissions retain entered fields and their existing pending feedback. Every placeholder is hidden from assistive technology, and reduced motion disables animation. Small screens stack the same regions as the loaded page and permit natural scrolling for longer forms. Evidence and review notes are in `.impeccable/review/page-skeletons/`.

Control states (2 October 2026): Dashboard and authentication share disabled-control cursor rules. Unavailable buttons, inputs, selects and textareas use not-allowed; wait is reserved for explicitly busy buttons and the disabled submit control of a pending form. Disabled controls retain their idle appearance on hover and press. Async actions clear aria-busy when complete or failed, and Courier field edits cannot re-enable a pending connection. Evidence is in `.impeccable/review/control-states/`.


## Campaign editor layout — 2 October 2026

Campaign creation places campaign name at the top of a wider left filter panel and the audience table on the right. Each filter occupies its own row. Courier, Contact Channel, minimum deliveries and minimum value update results live; text and numeric edits debounce for 300ms, and stale responses cannot replace newer results. Contact Channel offers WhatsApp, disabled IMO and All. Delivery-date controls, recipient breakdown, the filter accordion and the redundant ready/matching count are removed.

The audience reuses the Leads DataTable shell, Tabulator styling and infinite loader. Desktop shows Name, Phone, Contact, Deliveries and Total Value (BDT); mobile shows Name and Phone. Scrolling loads additional batches, with Load more and Retry as accessible fallbacks. All matching leads remain included regardless of which batches are visible. Filter changes restart the list. Continuing requests a fresh audience for the current filters.

The connected three-step indicator is centered above the workspace. Active steps use the green marker; earlier steps show a check. Campaigns navigation sits at the right of the shared header. Draft state and campaign actions stay in the bottom action bar. Standard desktop viewports fit without page overflow; mobile stacks always-visible filters above the table and permits natural scrolling. Audience filters is a plain heading and never collapses the controls. Initial skeletons follow the same layout.

Verified at 1440×900, 1200×700, 390×844 and 320×640 with synthetic requests. Live filtering, infinite loading, append failure/retry, stale-response suppression, empty results and message-step navigation passed. No horizontal overflow. Astro check and build passed; 52 campaign, infinite-source and loading tests passed using in-memory mocks. Evidence: `.impeccable/review/campaign-audience-infinite/`.

Campaign UI cleanup (2 October 2026): The audience editor omits name/phone search at the owner’s request; courier, contact channel and minimum delivery/value filters remain. Its skeleton has four matching filter placeholders. Campaign details use the existing screen-reader loading announcement without visible loading text; errors retain their status message and retry control. Headers with a campaign back arrow have no leading padding and retain the 44px touch target. Desktop (1440×900) and mobile (390×844) filtering, step navigation, loading and failure states passed with synthetic browser requests. Astro check and build passed; 46 existing campaign/loading tests passed. Evidence: `.impeccable/review/campaign-ui-cleanup/`.

Campaign actions (2 October 2026): Card actions use 14px pencil and trash icons with labels retained. These small controls are 32px high with 5px × 8px padding, 12px text and a 4px icon gap. Confirmation-modal controls retain their 44px height and 18px icon. Destructive controls use the existing error foreground with a soft red #f7e7e2 surface and #e7c7c3 border; hover uses #f1d8d3 and #dcb0ab. Clicking Delete opens a native confirmation dialog naming the campaign. Keep campaign receives initial focus; Tab stays inside, Escape cancels, and cancellation restores focus. During deletion, dismissal and duplicate submissions are blocked. Failure stays visible in the modal with retry available; success closes it and refreshes the list. Verified at 1440×900, 390×844 and 320×640 with synthetic requests. Evidence: `.impeccable/review/campaign-action-icons/`.

Campaign controls and refresh icons (2 October 2026): Mobile Duplicate and Archive use accessible 44px icon buttons beside the campaign title; desktop retains text labels. Compact headers truncate long titles and status text. The audience table has no refresh control; filter changes still reload it automatically. Both forward composer steps use Next with a right arrow; final Start campaign and Schedule campaign actions retain their labels. Refresh actions in Leads, Users, Campaigns and Media use the shared circular-arrow `src/components/RefreshIcon.astro`; do not restore the previous two-arrow shape. Verified at 1440×900, 390×844 and 320×640 with synthetic API responses, including action failure recovery, keyboard focus, filters, step navigation and final labels. Evidence: `.impeccable/review/ui-action-refresh/`.

Campaign stepper and back navigation (2 October 2026): Mobile step items and buttons align from the top so a wrapped Review & schedule label does not shift its marker or connectors. Campaign headers retain the shared header spacing around the back navigation. The back link has zero padding on desktop and mobile; the 44px touch target and keyboard focus remain. Verified at 1440×900, 760×900, 390×844 and 320×640 with synthetic API responses, step navigation and no horizontal overflow. Evidence: `.impeccable/review/campaign-stepper-back/`.

Table name alignment (2 October 2026): Shared DataTable columns with the `name` field align their headers and cell contents left, including the Leads Customer column and campaign audience Name column for both account roles. Other columns retain their existing alignment; Users business names already align left. Verified using synthetic browser responses at 1440×900 and 390×844, including header alignment, formatter placement, retained phone alignment and no horizontal overflow. Astro check and build passed. Evidence: `.impeccable/review/name-alignment/`.


## Message composer — 2 October 2026

The Message step uses a white editor with a single 44px formatting row, customer/company insertion below the text, and the character count beside the Message label. Extra formatting uses a native popover positioned within the viewport; selection closes it and returns focus to the editor, while Escape, outside clicks, scrolling and resizing dismiss it. Attachments combine the file limit, Media library link and Add media action on one row. Send text separately appears only when attachments are selected. Raw text is removed at the owner’s request.

Desktop places the editor beside a white preview panel with a muted chat area; mobile stacks these regions, uses a compact textarea and scrolls naturally with the action bar retained. Existing cream, green, type and focus styles remain authoritative.

WhatsApp’s official formatting guide supports every retained formatting action: bold, italic, strikethrough, inline code, monospace, bulleted lists and quotes. Images/videos and captions remain supported. Name and Company are substituted before sending. Line formats prefix complete selected lines; inline formats wrap each selected line, and the preview renders lists, quotes and multiline monospace. The preview is illustrative rather than a guarantee of every WhatsApp client’s typography.

Verified at 1440×900, 1200×700, 390×844 and 320×640 with synthetic in-memory browser responses. No horizontal overflow; toolbar controls retain 44px targets and the formatting popover remains within the viewport. All seven formatting actions, focus restoration, Escape dismissal, personalization, empty preview, media picker cancellation, mock draft saving and review navigation passed. Evidence: `.impeccable/review/message-composer/`.

Composer alignment and media recovery (2 October 2026): Message and Chat preview occupy equal desktop columns with aligned top and bottom edges, filling the space above the action bar. The left column groups the label and count, formatting, flexible textarea, personalization and an attachments footer inside one white panel. Short desktop viewports reduce padding and preview media height; mobile uses a 140px textarea and stacks the panels with natural page scrolling. Name, text and caption edits update only the preview text, preserving connected image/video elements. Failed preview media displays an explicit Retry image or Retry video action. No automatic retries occur during typing. Verified at 1440×900, 1200×700, 390×844 and 320×640 with synthetic data and a development-only media endpoint, removed before building. Evidence: `.impeccable/review/composer-full-height/`. The shared production D1 account initially reached its free daily row-read limit. After the owner upgraded Workers, live campaign requests and the original attachment succeeded; changing Preview as to Test kept the image visible.

Campaign timing and WhatsApp setup (3 October 2026): Review offers Instant and Schedule for later under Start sending. Instant starts as soon as preparation completes at any hour; scheduled delivery uses the chosen Dhaka date/time without a business-hour window. The cutoff field and expiry behavior are removed. Campaign sending setup links to WhatsApp. Its right desktop column now puts Campaign sending above compact Test destinations; Connection stays on the left at viewport height. Mobile stacks these panels and scrolls naturally. Unverified senders see a delivered-test selector, a client confirmation checkbox and Verify & enable sending. Pending or incomplete tests are disabled. Verified senders see an enable/disable action and a closed verification disclosure. Sender changes, disconnected states, loading, refresh, errors and recovery have explicit feedback. Each account configures only its own sender. Desktop and mobile browser mocks verify both campaign timing modes and the full settings flow at 1440×900, 1200×700, 390×844 and 320×640 with no horizontal overflow. Evidence: `.impeccable/review/campaign-delivery-settings/`.


Campaign test requirement removal (3 October 2026): The Campaign sending panel and verification/enablement flow are removed. WhatsApp now presents Connection and optional Test destinations side by side on desktop, stacked on mobile. Campaign Review permits launch without a test. Connected-sender checks, campaign pause/resume, restrictions and recipient eligibility remain enforced. Historical verification and enablement records are ignored.
Verified with synthetic browser responses at 1440×900, 1200×700, 390×844 and 320×640. Both WhatsApp and campaign review have no horizontal overflow; launch remains available with no configured test receivers. Evidence: `.impeccable/review/campaign-test-removal/`. No shipping raster assets or new design tokens were introduced.


Campaign sending rules (3 October 2026): Review & schedule displays four always-visible bullets instead of the Delivery details & estimate disclosure. Copy explains the six-second interval, 450 daily sender attempts with Dhaka-midnight reset, seven-day customer cooldown and fixed launch audience/content. The estimate uses compiled message parts: an image with a caption counts once, while separate text counts separately. Full recipient bundles determine daily capacity. Review panels expand with their content on shorter screens; primary actions remain in the existing sticky footer. The cream/white/green palette and existing typography remain unchanged. Synthetic desktop and mobile captures, validation and the review verdict are recorded in `.impeccable/review/campaign-sending-rules/`. No shipping raster assets were introduced.


Media layout (3 October 2026): Media uses a 1:2 desktop layout above 1100px, with a centered upload panel and a larger library panel. Both panels fill the available desktop height. The library displays six files in three columns from 1360px, four in two columns on smaller desktop widths, and six in three columns on tablet. Mobile stacks a compact upload panel above a two-column, four-file library with natural page scrolling. Short desktop windows use smaller thumbnails; preview and delete actions retain 44px touch targets, with icon-only preview on mobile. Image-background controls are removed, and uploads use the service's default image preparation. Existing search, filtering, upload progress, preparation feedback, previews, deletion and pagination remain.

Verified with synthetic in-memory browser responses at 1440×900, 1200×700, 900×800, 390×844 and 320×640. No horizontal overflow; desktop fits both tested viewport heights. Upload, invalid-file recovery, search, type filters, pagination, preview, empty results, refresh recovery, failed/successful deletion and focus restoration passed. Astro check and build passed. Builder review and evidence: `.impeccable/review/media-layout/`. No shipping raster assets or new design tokens were introduced.
