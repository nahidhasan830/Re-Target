# Pathao merchant authentication

Verified on 2 October 2026 against `https://merchant.pathao.com`, using the merchant account supplied for testing. These are merchant-portal endpoints, not the public Aladdin booking API. No client ID, client secret, analytics cookies, or browser clearance cookie is required for the verified flow.

## Initial login

`POST https://merchant.pathao.com/api/v1/login`

Headers: `Accept: application/json`, `Content-Type: application/json`.

```json
{
  "username": "merchant@example.com",
  "password": "<merchant password>"
}
```

A successful HTTP 200 response contains `token_type`, `access_token`, `refresh_token`, and `expires_in`. The live response reported `expires_in: 7776000` (90 days). Use the returned value; do not assume this lifetime is permanent. The provider does not expose the refresh token's expiry in this response.

Authenticated requests use `Authorization: Bearer <access_token>`. `GET /api/v1/user` is the read-only connection check; the verified response has `data.merchant_id`.

## Native refresh

The refresh grant uses **the same login endpoint**:

`POST https://merchant.pathao.com/api/v1/login`

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "<latest saved refresh token>"
}
```

Use the same JSON headers. Do not send `username`, `password`, or an old bearer token with this grant. Both access and refresh tokens rotated in two consecutive live refreshes. Each new access token successfully read `/api/v1/user`. Persist the complete new pair before another refresh and never reuse the previous refresh token.

Separate `/api/v1/refresh` and `/api/v1/refresh-token` guesses did not issue tokens. With a bearer token those requests returned an error envelope with HTTP 200; without one they returned a bearer-token error. HTTP 200 alone is not evidence of successful renewal.

An invalid refresh token produced HTTP 400 with a credentials-refused message. Treat 400/401/422 from the login grant as refused authentication, and expose a reconnect action. Do not automatically fall back to password login. Handle rate limits, server failures, unexpected payloads, and timeouts separately.

## Re-Target implementation

- Both Courier forms accept only merchant email and password. Pathao's former API application fields are removed. Existing saved Pathao email/password can be reused.
- Save persists credentials without a courier call. Connect saves changes, establishes or reuses the session, and checks the merchant profile.
- `src/lib/courier-auth.ts` implements the initial grant and refresh grant. `src/lib/courier-sessions.ts` provides the persistent session manager and `courierRead(account, 'pathao', path)` for authenticated GET requests.
- D1 holds AES-256-GCM encrypted credentials and a separately encrypted token pair. Encryption is bound to the account owner and provider; token encryption additionally uses a session-specific binding. Passwords and tokens are never returned to page markup or included in diagnostic messages.
- Reuse the access token while more than five minutes remain. Renew on the next server request near expiry. Page rendering alone does not log in or refresh.
- If a resource returns 401, renew and retry the read once. Concurrent requests that rejected an older token reuse a newer saved token.
- An atomic D1 lease serializes renewal across Worker instances. Credential identity and session version prevent stale requests from overwriting new credentials or rotated tokens. Leases expire after 60 seconds; busy callers receive a recoverable in-progress response.
- A failed renewal retains the saved token pair, releases its lease, and applies a 30-second cooldown. No password-grant loop runs. Reconnect is an explicit user action, also subject to rate limiting.
- Blank saved passwords preserve credentials and sessions. Changing email or password invalidates the session. Migration `0006_outgoing_doomsday.sql` adds session and lease columns without removing existing data.

## Verification and scope

Live checks verified initial login, repeated native refresh, token rotation, and protected merchant reads. The implemented renewal function was also exercised with empty email/password arguments and the previously issued refresh token; it renewed successfully.

Automated tests cover rotation, malformed/refused responses, no password fallback, encrypted persistence, account isolation, concurrent renewal, bounded read retries, credential changes, cooldowns, and explicit reconnect. Local migration, application checks, production build, and deployment dry run were verified. The complete local application also connected the account, simulated access-token expiry in encrypted storage, renewed natively with a blank submitted password, and persisted the rotated encrypted pair.

Authentication is available to the future consignment importer. This change does not implement shipment discovery, pagination, lead import, or scheduled synchronization. The Leads sync button remains unavailable until that importer is implemented. Production deployment is separate from the local/live-provider verification above.
