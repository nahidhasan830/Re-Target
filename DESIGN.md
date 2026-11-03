---
name: Re-Target
description: Jamdani Loom. Calm muslin and indigo ink, one rani thread for the next action, woven status marks.
colors:
  ground: "#f2f3f7"
  surface: "#fff"
  surface-2: "#f7f8fb"
  surface-3: "#eceef4"
  line: "#e0e3ec"
  line-strong: "#c7ccd9"
  ink: "#121a2f"
  ink-2: "#4b5470"
  ink-3: "#687089"
  rani: "#b0125b"
  rani-hover: "#970f4e"
  rani-press: "#7f0c42"
  rani-soft: "#fbe9f1"
  rani-text: "#b0125b"
  on-rani: "#fff"
  indigo: "#3341a8"
  indigo-soft: "#e9ecfb"
  focus: "#3341a8"
  leaf: "#17784a"
  leaf-soft: "#e3f4ea"
  turmeric: "#8a5b00"
  turmeric-mark: "#d99a0b"
  turmeric-soft: "#fcf1d5"
  vermilion: "#b8321c"
  vermilion-soft: "#fbe9e5"
  vermilion-line: "#efc6be"
  on-vermilion: "#fff"
  anchal: "#1b2156"
  anchal-thread: "#eef0fa"
  chat: "#e7ebe2"
  bubble: "#d6f2c9"
  bubble-ink: "#1b2e1f"
typography:
  headline-large:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 640
    lineHeight: 1.25
    letterSpacing: "-.025em"
  headline:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.375rem"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-.02em"
  title:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-.012em"
  brand:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 680
    letterSpacing: "-.025em"
  body:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: ".9375rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  body-small:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: ".8125rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: ".8125rem"
    fontWeight: 560
    lineHeight: 1.35
  button:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: ".875rem"
    fontWeight: 600
    lineHeight: 1.2
  caption:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: ".75rem"
    fontWeight: 600
    lineHeight: 1.2
  micro:
    fontFamily: "'Anek Bangla Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: ".6875rem"
    fontWeight: 560
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: ".9375rem"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
components:
  button-primary:
    backgroundColor: "{colors.rani}"
    textColor: "{colors.on-rani}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.rani-hover}"
  button-primary-active:
    backgroundColor: "{colors.rani-press}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  button-secondary-pressed:
    backgroundColor: "{colors.indigo-soft}"
    textColor: "{colors.indigo}"
  button-secondary-destructive:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.vermilion}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-destructive-hover:
    backgroundColor: "{colors.vermilion-soft}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.on-vermilion}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    size: "44px"
  icon-button-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "44px"
  chip:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "2px 9px 2px 8px"
    height: "24px"
  chip-success:
    backgroundColor: "{colors.leaf-soft}"
    textColor: "{colors.leaf}"
  chip-warning:
    backgroundColor: "{colors.turmeric-soft}"
    textColor: "{colors.turmeric}"
  chip-danger:
    backgroundColor: "{colors.vermilion-soft}"
    textColor: "{colors.vermilion}"
  chip-info:
    backgroundColor: "{colors.indigo-soft}"
    textColor: "{colors.indigo}"
  chip-accent:
    backgroundColor: "{colors.rani-soft}"
    textColor: "{colors.rani-text}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  panel-header:
    padding: "10px 16px"
    height: "56px"
  anchal-panel:
    backgroundColor: "{colors.anchal}"
    textColor: "{colors.anchal-thread}"
    rounded: "{rounded.lg}"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "40px"
  nav-link-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
  nav-link-current:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  tab:
    textColor: "{colors.ink-3}"
    typography: "{typography.micro}"
    height: "60px"
  tab-current:
    textColor: "{colors.indigo}"
  segmented:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-option-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "38px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  form-error:
    backgroundColor: "{colors.vermilion-soft}"
    textColor: "{colors.vermilion}"
    typography: "{typography.body-small}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  chat-bubble:
    backgroundColor: "{colors.bubble}"
    textColor: "{colors.bubble-ink}"
    padding: "10px 12px"
---

# Design System: Re-Target

## Overview

**Creative North Star: "The Jamdani Loom"**

Re-Target is a working loom for small Bangladeshi merchants: delivered parcels become threads, and each screen weaves them into the next offer. The ground is calm cool muslin with indigo-black ink; colour is spent as thread, and each thread colour carries exactly one meaning. A single rani thread marks the next action.

Density is operational: 44px controls, hairline borders, full-width workspaces, and a 4px rhythm. Ornament is woven, not printed. The booti diamond is the status mark, the paar band edges the brand surfaces, and the indigo anchal panel holds the woven field. Light is the default. Dark follows the system and is the same loom at night: an ink-blue ground with brighter threads, never gray on gray.

**Key Characteristics:**
- Muslin ground, white surfaces, 1px hairlines; depth comes from tone, not shadow.
- One meaning per thread colour: rani acts, indigo locates, leaf completes, turmeric waits, vermilion fails.
- Diamond (booti) geometry for every status, current and step marker.
- Anek Bangla Variable for Latin and Bangla with tabular numerals throughout.
- Motion only for state changes: 120/200/320ms on an exponential ease-out.

## Colors

Cool, low-chroma neutrals carry the screen; five saturated thread colours are reserved for meaning. Every value has a dark-scheme override in the sidecar.

### Primary
- **Rani Thread** (rani): the next or primary action and links. Solid primary buttons, the dashboard's next step, text actions. Hover and press deepen it (rani-hover, rani-press); the soft tint marks the next-step row. Rani text (rani-text) matches rani in light and lifts to a pink (#ff7ab2) in dark for legible links.

### Secondary
- **Indigo Ink** (indigo): location, selection, focus and information. The current nav item's icon and diamond, the selected tab, pressed toggles, selected media, info chips, checkbox accents, and the 2px focus outline (focus) with a 3px soft ring on fields.

### Tertiary (status threads)
- **Leaf** (leaf): done, connected and delivered. Completed steps, the warp thread between completed steps, connected chips, success feedback.
- **Turmeric** (turmeric, turmeric-mark): waiting. Text uses the deep turmeric; the brighter turmeric-mark fills only the diamond, because the text tone is too dark for a mark and the mark tone is too light for text.
- **Vermilion** (vermilion): failed and destructive. Field and form errors, failed chips, outlined and solid destructive buttons.

### Neutral
- **Muslin** (ground): the page, sidebar and topbar.
- **Cotton White** (surface), **Pale Muslin** (surface-2), **Washed Muslin** (surface-3): panels and inputs, quiet hover and disabled fills, neutral chips and segmented tracks.
- **Hairline** (line) and **Firm Hairline** (line-strong): panel borders and dividers; input and secondary-button strokes.
- **Indigo-Black Ink** (ink), **Faded Ink** (ink-2), **Pale Ink** (ink-3): text, secondary text, placeholders and idle icons.
- **Anchal Indigo** (anchal) with **Anchal Thread** (anchal-thread): the deep woven panel on auth and the dashboard's next-step panel.
- **Chat Ground** (chat), **Message Bubble** (bubble), **Bubble Ink** (bubble-ink): only the WhatsApp-style message preview.

### Named Rules
**The One Thread, One Meaning Rule.** A thread colour states one fact. Rani means "do this next"; indigo means "you are here or this is selected"; leaf means done; turmeric means waiting; vermilion means failed or destructive. Never borrow a thread for decoration.

**The Single Rani Rule.** At most one solid rani control per form or task region (Account and Courier carry one per independent form). Every other action is secondary, ghost or a text link.

**The Same Loom at Night Rule.** Dark mode keeps every role and lifts the threads to stay legible on the ink-blue ground. The WhatsApp QR code is the exception: it stays dark on white in both schemes so phones can scan it.

## Typography

**Display Font:** Anek Bangla Variable (self-hosted; Latin subset preloaded, Bengali by unicode-range), falling back to system-ui
**Body Font:** Anek Bangla Variable
**Label/Mono Font:** ui-monospace stack, for codes only

**Character:** One humanist variable family carries both Latin UI and Bangla customer names at fine weight steps (400 to 680), so hierarchy comes from weight and size rather than a second face.

### Hierarchy
- **Headline Large** (640, 1.75rem, 1.25): the auth heading, dashboard greeting and the anchal next-task line. Drops to headline size on mobile and short desktops.
- **Headline** (620, 1.375rem, 1.25): page titles in the topbar (1.125rem on mobile).
- **Title** (620, 1.0625rem, 1.25): section headings; panel headers use body size at the same weight.
- **Body** (400, .9375rem, 1.55): default text and inputs; intros cap at 65ch.
- **Body Small** (400, .8125rem, 1.45): the workhorse for meta, hints, table cells and messages.
- **Label** (560, .8125rem): field labels. **Button** (600, .875rem) for buttons and nav. **Caption** (600, .75rem) for chips and nav group names. **Micro** (560, .6875rem) for tab bar labels only.

### Named Rules
**The Tabular Rule.** Body text sets tabular numerals globally; counts, dates and 01XXXXXXXXX phone numbers align in columns without extra styling.

**The Weight Ladder Rule.** Headings climb by weight steps (560, 600, 620, 640, 680), never by uppercase or tracking. Labels stay sentence case.

## Layout

The desktop shell has a fixed 236px sidebar on the ground colour, a 64px sticky topbar (title, meta, actions) and an uncapped main area padded 20px by 28px. Content uses the full width. Primary views fit the viewport height using the shell's content-height metric, and lists paginate rather than scroll the page.

At 760px and below the sidebar is replaced by a 56px topbar with a small brand mark, 16px padding, and a fixed 60px bottom tab bar (Home, Campaigns, Leads, Media, More). More opens a bottom sheet with the remaining destinations. Focus mode (the campaign workspace) hides the tab bar and the topbar brand so composer actions own the bottom edge.

Auth splits into the form column (max 400px, centred) and a 42% anchal panel. At 860px and below the anchal collapses to a 72px woven band above the form.

Spacing is literal pixels on a 4px base, from the spacing scale. Common gaps are 8, 12, 16, 20 and 24px; panels pad 16px. Component breakpoints cluster at 760, 1000/1100 and 1200px, plus desktop height queries (700 to 800px) that tighten vertical rhythm.

## Elevation & Depth

The system is flat and tonal. Depth comes from the muslin, white and washed surface steps and from hairlines. Only two shadows exist, and both have narrow jobs.

### Shadow Vocabulary
- **Raised thread** (`0 1px 2px rgb(18 26 47 / .06), 0 0 0 1px var(--line)`): only the selected item lifted out of a track, meaning the current nav link and the selected segmented option.
- **Overlay** (`0 18px 44px -14px rgb(18 26 47 / .28), 0 2px 8px rgb(18 26 47 / .06)`): dialogs and the mobile More sheet over a 45% ink backdrop.

### Named Rules
**The Flat Panel Rule.** Panels, cards and rows never cast shadows. They separate with a hairline and a surface step.

## Shapes

Corners are gently rounded on a 4px family: 8px on controls, inputs, buttons and nav items; 12px on panels, media cards and the anchal panel; 16px on dialogs and the top of sheets; 6px on chips and segmented options. The recurring silhouette is the **booti**, a square rotated 45° with a 1 to 4px radius. It is used for chip dots, field-error marks, the current nav diamond, the tab bar's current marker, step markers, the empty-state frame and the brand mark. Lines are 1px hairlines; the warp thread is 2px.

**The Booti Rule.** Status, currency and progress are always marked with a diamond, never a circle dot. Circles are reserved for spinners.

## Components

### Buttons
- **Shape:** gently rounded (8px), 44px tall (48px on auth and the anchal action), 16px horizontal padding, 18px icons with an 8px gap.
- **Primary:** solid rani with white text; it deepens on hover and press. This is the single next action.
- **Secondary:** white with a firm hairline stroke. When pressed or expanded it switches to indigo-soft with indigo text.
- **Destructive:** outlined destructive buttons are secondary with vermilion text and a vermilion-line stroke, and gain a vermilion-soft fill on hover. Solid vermilion danger is used only to confirm inside a dialog.
- **Ghost:** transparent with faded ink; washed fill on hover.
- **Icon button:** 44 × 44 transparent square, 20px icon, with an accessible name and the indigo focus outline.
- **States:** disabled at 55% opacity; busy shows a 16px spinner with a wait cursor. Transitions run 120ms.

### Chips
- **Style:** 24px, 6px radius, caption type, soft tint with its thread's text and a 6px booti dot in currentColor. The waiting dot uses turmeric-mark.
- **Tones:** success, warning, danger, info and accent map to the colour roles. A plain variant drops the dot for counts.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** white surface on the muslin ground.
- **Shadow Strategy:** none (see Flat Panel Rule).
- **Border:** 1px hairline. Headers are 56px with a hairline divider.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** white fill, firm hairline stroke, 8px radius, 44px minimum height (48px on auth), rani caret. Selects carry a drawn chevron. Base rules have zero specificity so components can override them.
- **Focus:** indigo border plus a 3px soft indigo ring.
- **Error / Disabled:** vermilion border and ring; the inline error is preceded by a 6px booti. Form-level errors sit in a vermilion-soft box. Disabled fields use pale muslin and pale ink.
- **Password:** a 44px eye or eye-off toggle sits inside the field's right edge.

### Navigation
- **Sidebar:** a paar band on top, then the brand and grouped links (caption-size group names in pale ink). Links are 40px with 20px icons. The current link lifts onto white with the raised-thread shadow, an indigo icon and a 6px indigo diamond at the right. Account and Log out are pinned at the bottom.
- **Mobile:** a five-slot tab bar with 22px icons and micro labels; the current tab turns indigo with a diamond above the icon. The More sheet slides up in 320ms.
- **Segmented control:** a washed track with 38px options; the selected option lifts onto white.

### Signature: Paar Band
A 12px woven border: a repeating rani diamond row between two indigo hairlines at 45%, drawn with a CSS mask. It edges the sidebar top, the More sheet, the anchal panels and the next-step weave.

### Signature: Anchal Panel
A deep indigo panel woven with a faint booti field at 13–14% thread opacity between paar bands. On auth it frames a centred motif computed cell by cell. On the dashboard it holds the next task in white headline type with its rani action.

### Signature: Warp Checklist and Booti Stepper
Setup steps are strung on a 2px vertical warp thread. Each step's booti is outlined when idle, ringed in rani with a rani-soft row when it is next, turmeric when waiting, and filled leaf with a check when complete. The thread segments turn leaf as steps complete and draw in over 200ms. The campaign editor's stepper uses the same 28px booti markers.

### Empty State
A centred stack under a 64px diamond frame (a rotated pale-muslin square with a firm hairline) holding an indigo 22px icon; the copy is capped at 42ch.

### Data Table
Tabulator is themed to the tokens: hairline rows, indigo-soft selection, body-small cells and tabular figures.

## Do's and Don'ts

### Do:
- **Do** give each thread one meaning: rani for the next action and links, indigo for location, selection, focus and info, leaf for done, turmeric for waiting, vermilion for failed or destructive.
- **Do** mark status with the booti diamond, using the turmeric-mark tone for waiting dots.
- **Do** keep controls at 44px minimum with 8px corners, and give icon buttons accessible names.
- **Do** use the shared icon registry (24px grid, 1.7 stroke) and the shared circular-arrow refresh icon.
- **Do** use outlined destructive buttons for the first click and solid danger only to confirm.
- **Do** keep the WhatsApp QR code dark on white in both schemes.

### Don't:
- **Don't** use rani for status, location or decoration, and don't put more than one solid rani button in a form or task region.
- **Don't** add shadows to panels, cards or rows; separate with hairlines and surface steps.
- **Don't** use uppercase eyebrow labels, gradient text or coloured side borders.
- **Don't** use circle dots for status; circles belong to spinners.
- **Don't** introduce a second typeface for headings; climb by weight.
