# Steadfast merchant authentication

Verified on 2 October 2026 against `https://steadfast.com.bd`, using the merchant account supplied for testing. The merchant portal uses Laravel session and remember-me cookies. It does **not** issue an OAuth access/refresh token pair in the verified login flow. The native equivalent of token refresh is restoring a session from the remember-me cookie.

## Initial login

1. `GET https://steadfast.com.bd/login` with `Accept: text/html` and a browser-style User-Agent.
2. Retain fresh `Set-Cookie` headers. The verified response sets `XSRF-TOKEN` and `sfc_user_session`.
3. Read the plaintext CSRF value from `<input name="_token" value="…">` in that response. The encrypted `XSRF-TOKEN` cookie is not interchangeable with this form value.
4. `POST https://steadfast.com.bd/login` with the fresh cookies and `Content-Type: application/x-www-form-urlencoded`, `Origin: https://steadfast.com.bd`, and `Referer: https://steadfast.com.bd/login`.

Form fields:

```text
_token=<fresh plaintext form token>
email=<merchant email>
password=<merchant password>
remember=1
```

URL-encode the form fields. Do not paste an old CSRF token, browser session cookie, analytics cookies, or clearance cookie into the application.

The verified POST returned HTTP 302 and issued `sfc_user_session`, `XSRF-TOKEN`, and a `remember_web_<guard hash>` cookie. The remember-cookie name is dynamic; retain its actual name and value.

The supplied account redirected to `/user/profile/security/password/change`. A subsequent protected read still succeeded, so that redirect did not prevent the tested authentication flow. Do not change the merchant password automatically. If access later requires a password change, the account owner must complete it directly in Steadfast.

## Verify authentication

`GET https://steadfast.com.bd/user/frauds/create` with the stored cookie header is the read-only connection check.

A valid result is HTTP 200 with a plaintext `_token`, the expected protected form fields (`phone`, `details`, or `name`), and a current session cookie. A pre-login session cookie or redirect alone is not proof of authentication.

Keep redirects manual. A redirect to `/login`, a login/password form, or HTTP 401/419 means the session was rejected. Unexpected redirects, page structure, rate limits, blocks, and upstream failures must produce a visible error.

## Native session renewal

Reuse the session cookie while it remains valid. Near expiry, request the protected page with the saved cookies, including `remember_web_*`. Laravel restores the authenticated session from the remember-me credential and returns a new session cookie. No login POST or password is needed.

The live trial deliberately omitted the session cookie and sent **only the remember-me cookie**. The protected page returned HTTP 200 and issued fresh `XSRF-TOKEN` and `sfc_user_session` cookies. The implemented renewal function also succeeded with empty email/password arguments after its stored session cookie was expired.

Merge every cookie rotation and deletion from `Set-Cookie`. `Max-Age` takes precedence over `Expires`; discard expired cookies. Support both `sfc_user_session` and the legacy `steadfast_courier_session` name. Cookie expiry is authoritative; use a two-hour fallback only when a session cookie has no explicit expiry. Do not invent a fixed remember-me lifetime.

If the remember-me cookie expires, is revoked, or fails the protected check, require explicit Reconnect. Normal requests never silently repeat the password login. Server failures and rate limits do not trigger a login attempt.

## Re-Target implementation

- Steadfast now accepts merchant email and password instead of API key and secret key. Old API-key-only rows show Update login and require the new credentials; no merchant password can be recovered from API keys.
- Save persists credentials; Connect establishes or reuses the saved merchant session and verifies protected access. Reconnect is a separate explicit action after a failure.
- `src/lib/courier-auth.ts` implements CSRF login, cookie merging, protected verification, and remember-me restoration. `src/lib/courier-sessions.ts` persists state and exposes `courierRead(account, 'steadfast', path)` for authenticated GET requests.
- Passwords, session cookies, and remember-me cookies are encrypted in D1 using AES-256-GCM, with account/provider binding and separate session binding. Secret values never appear in HTML or diagnostics.
- A five-minute renewal margin, atomic 60-second D1 lease, session version checks, and 30-second failure cooldown protect concurrent requests. Expired leases recover automatically.
- Authenticated reads retain cookie rotations only when they belong to the current session. Rejected reads attempt one native restoration and one retry; repeated failure returns an actionable error.
- Changing credentials clears the stored session. Blank saved passwords preserve it. Migration `0006_outgoing_doomsday.sql` adds storage/lease columns and preserves existing data.

## Hosting limitation

The referenced `ready-cart-bd` app reports that Steadfast blocks Cloudflare Worker egress and uses an authenticated Node transport at `/api/internal/steadfast-transport`. The live checks above ran from this computer and do not establish that production Worker egress succeeds. Re-Target's production deployment needs a verified direct connection or a configured Node transport. `src/lib/steadfast-transport.ts` adds optional support for the same Node transport contract, with an allowlist limited to login and the protected authentication check. The transport forwards requests; Re-Target continues to own its per-account encrypted cookies, leases, and renewal decisions.

Configure both server-only settings together:

```text
STEADFAST_TRANSPORT_URL=https://your-node-host/api/internal/steadfast-transport
STEADFAST_TRANSPORT_TOKEN=<private token accepted by the Node endpoint>
```

Keep the token in `.dev.vars` locally and as a Cloudflare secret in production. The existing reference endpoint expects its `COURIER_AUTH_TOKEN` value as the bearer credential; never put it in frontend code. With neither setting present, requests use the direct connection. Partial/invalid configuration fails visibly. The adapter preserves individual Set-Cookie headers and manual redirects, bounds response sizes, and never forwards a request to an arbitrary courier URL.

Transport response JSON contains `status`, `body`, `cookies` (an array of individual Set-Cookie strings), `type`, and `location`. Both login CSRF and protected-read cookie rotations pass through it.

The project owner selected the existing ready-cart-bd transport. Re-Target now configures `https://rcbd-order-desk.vercel.app/api/internal/steadfast-transport` privately with the existing bearer credential. The credential is stored in local `.dev.vars` and the private production-secret file for the next deployment; it is never embedded in source or this document. The deployment script provisions these settings when they are missing remotely. A live hosted login-page probe succeeded, followed by successful initial login and simulated expired-session renewal through the complete local application and this hosted transport. Both runs persisted the resulting encrypted session. Production publication remains subject to deployment approval.

## Verification and scope

Automated tests cover fresh CSRF login, remember-only restoration, cookie rotation/deletion/expiry, refused renewal, no password fallback, encrypted persistence, concurrency, credential changes, safe errors, and retry limits. Existing application tests, local migration, production build, and deployment dry run were verified. Full application checks additionally verified initial connection and simulated session-expiry restoration through the selected hosted transport.

This change establishes merchant authentication. It does not import consignments or leads or enable scheduled synchronization. The Leads sync button remains unavailable until a shipment-discovery adapter and importer are implemented. No production deployment was performed as part of this verification.
