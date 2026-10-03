# Re-Target

## Project brief

Re-Target is an invite-only outreach application for businesses in Bangladesh. It imports customers with delivered courier shipments and sends them customized offers.

### Roles and access

- **Admin:** The project owner; invites users through their WhatsApp numbers.
- **User:** An invited business account holder.
- **Onboarding:** The user opens the invitation link and sets a password and company name.
- **Login:** After onboarding, the user signs in with their phone number and password.
- **Registration:** Invite only; no public signup.

### Courier integrations and outreach

- Support **Pathao** and **Steadfast** courier integrations.
- Collect each user's merchant email and password; reuse encrypted sessions and renew through Pathao refresh tokens and Steadfast remember-me cookies.
- Fetch customers whose shipments were delivered and use them as recipients for customized offers.
- Initial outreach channels: **imo** and **other**. The meaning and scope of “other” are not yet defined.

### Phone numbers

- All phone numbers are Bangladeshi.
- Display and accept phone numbers in the local 11-digit format: `01XXXXXXXXX`.
- Keep the country code in the underlying representation when needed; show only the local format in the interface.

## Project preferences

- Avoid verbose code comments throughout this project. Add only brief comments for non-obvious decisions; omit comments when the code explains itself.

### UI and UX

- Build mobile-first, with equal care for mobile and desktop usability, layout, and visual polish. Verify both sizes.
- Use the available desktop width where it helps the task; avoid narrow content columns that leave useful workspace empty.
- Prefer a single-screen experience that fits the viewport height and width without unnecessary scrollbars. Use compact spacing, responsive columns, pagination, and progressive disclosure where appropriate; keep primary controls visible. Preserve readable content, comfortable touch targets, and natural scrolling when small screens, zoom, or long content require it. Avoid nested scrolling for routine forms.
- Use modern, uncluttered interfaces and concise copy. Keep only information that helps the user complete the current task.
- Avoid redundant notices and helper text. On login, omit invitation/access notices and phone-format explanations; the `01XXXXXXXXX` placeholder is sufficient. Retain accessible field labels and show validation errors when needed.
- Use familiar icons for compact actions, including an eye/eye-off icon for password visibility. Give icon buttons accessible names, visible keyboard focus, and touch targets of at least 44 × 44 pixels.
- Use the shared `src/components/RefreshIcon.astro` circular-arrow icon for refresh actions throughout the UI. Do not reuse the old two-arrow refresh/sync shape shown in earlier implementations.
- Keep form interactions keyboard-friendly; pressing Enter in either login field must submit the form.
- Label the WhatsApp navigation item and pages “WhatsApp”, without “My”.

## Development workflow

Use the single production D1 database and R2 bucket for both localhost and the deployed app, with remote queue producers. Never create a local application database, copy production data into an emulator, or seed live data for automated tests. Automated tests use in-memory mocks only.

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
