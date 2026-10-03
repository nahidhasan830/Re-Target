# Mac-hosted WAHA

WAHA runs on this Apple Silicon Mac with WPP. WEBJS was the initial engine, but the owner’s WhatsApp Business account failed during linking while normal WhatsApp Web succeeded. WPP linked successfully and retained the account after a container restart. The old WEBJS data remains in its separate namespace inside the same volume. Re-Target remains on Cloudflare. The Docker image is pinned by digest; upgrades are deliberate.

## Local service

```sh
npm run waha:init
npm run waha:start
npm run waha:status
npm run waha:pair
npm run waha:verify
npm run waha:backup
npm run waha:stop
```

`waha:init` generates credentials without overwriting an existing file. The dashboard is at http://127.0.0.1:3000/dashboard. Its username is `admin`; the password and API key are stored privately in `infra/waha/.env`. Swagger is disabled. The API requires `X-Api-Key`.

Use **WhatsApp** at https://retarget.nahidlabs.com/admin/whatsapp to pair within Re-Target. The QR checks for a fresh code every five seconds while the page is visible, with a countdown to the next refresh. It hides after connecting and shows the linked local phone number. Polling pauses when the page is hidden and resumes with a fresh request on return. **Account** at `/admin` shows login details.

For command-line recovery, `waha:pair` creates or starts the `admin` session and saves `.waha/admin-qr.png`. Open that image and scan it from WhatsApp → Linked devices → Link a device. QR codes expire quickly; rerun the command for a fresh image. A failed session is restarted on the next attempt. WhatsApp may revoke a linked device, requiring a new scan.

The named Docker volume `re-target-waha-sessions` stores authentication at `/app/.sessions`. Stopping, restarting, or replacing the container preserves it. **Do not run `docker compose down -v` or delete the volume.** D1 stores account ownership and session metadata; it does not hold WAHA's authentication files.

`waha:start` opens Docker Desktop if needed and waits for a healthy service. It prevents idle sleep using a dedicated `caffeinate -i` process until `waha:stop`. Keep the Mac connected to power with its lid open. Explicit sleep, closing the lid, shutting down, losing Internet access, or stopping Docker makes sending unavailable.

Enable Docker Desktop's “Start Docker Desktop when you sign in” setting if desired. The container's `unless-stopped` restart policy works once Docker starts; it does not launch Docker Desktop itself. After a reboot, run `waha:start` to restore WAHA, its provisioned tunnel, and sleep prevention. Other Docker projects and tunnels are not stopped by these commands.

## Protected Cloudflare connection

Enable Cloudflare Zero Trust's Free plan for the existing account. Provisioning requires an API token scoped to that account and `nahidlabs.com` with:

- Account: Cloudflare Tunnel → Edit.
- Account: Access: Apps and Policies → Edit.
- Account: Access: Service Tokens → Edit.
- Zone: Zone → Read and DNS → Edit.

Store only the token in `.waha/cloudflare-api-token`, with owner-only permissions (`chmod 600 .waha/cloudflare-api-token`). It is ignored by Git. An existing Wrangler login is used if that file is absent, but its default OAuth scopes may not permit these writes.

```sh
npm run waha:cloudflare
npm run waha:tunnel
npm run waha:verify -- --remote
```

Provisioning creates a remotely managed `re-target-waha` tunnel, an Access application covering all of `waha.nahidlabs.com`, and a Service Auth policy restricted to one dedicated service token. It configures DNS only after verifying that policy. Conflicting resources are not overwritten. The existing unrelated tunnel is left untouched.

The tunnel is a separate native `cloudflared` process with its own empty configuration, private token file, PID, and log under `.waha/`. Its token is not passed in process arguments. `waha:stop` stops this process as well as WAHA. `waha:start` also starts the tunnel after provisioning; `waha:tunnel` can start it separately and is safe to repeat.

The service token expires after one year. Its expiry is saved in `.waha/cloudflare.json`. Renew it in Cloudflare before expiry; rotating its secret requires updating the private state and Worker secrets. Never print these files or paste them into chat.

Authenticated backend requests require all three headers:

```text
X-Api-Key: <WAHA_API_KEY>
CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>
CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>
```

Four server-only values are saved in `.waha/worker-secrets.json`, merged into `.dev.vars`, and uploaded to the existing Worker after the tunnel authentication check passes: `WAHA_BASE_URL`, `WAHA_API_KEY`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET`. Existing admin credentials are retained. Do not use `PUBLIC_` variables or send these credentials to browser code.

Local development uses `http://127.0.0.1:3000` for `WAHA_BASE_URL`; the deployed Worker uses `https://waha.nahidlabs.com`. Access credentials are attached only to HTTPS gateway requests.

If provisioning stops because DNS write permission is missing, add the specified proxied CNAME in the Cloudflare dashboard, then run:

```sh
npm run waha:tunnel
npm run waha:verify -- --remote
node scripts/waha-cloudflare.mjs publish-secrets
```

The local dashboard remains available directly on the Mac. The remote hostname requires service authentication; it is not a publicly accessible dashboard.

## Backup and recovery

`waha:backup` briefly stops WAHA to make a consistent copy of SQLite and browser session files, writes an owner-only archive under `backups/waha/`, and restarts the container even if the copy fails. No logout is performed. Backups contain sensitive linked-device credentials; keep them private and encrypted when moving them off the Mac. Back up `infra/waha/.env` and `.waha/` privately as well.

To recover on this Mac, stop WAHA, preserve the existing volume separately, and extract the selected archive into `re-target-waha-sessions` using the pinned image and `tar`. Do not restore over a running session. Start WAHA and verify the connected number; revoked WhatsApp credentials still require reconnection.

## Verification and remaining application work

`waha:verify` checks unauthenticated rejection and authenticated session listing. `--remote` also verifies that Access credentials alone cannot bypass the WAHA API key and that a WAHA key alone cannot bypass Access.

The remote check uses fresh DNS resolution for a newly created hostname; HTTPS still verifies the hostname and certificate normally.

The admin account was linked with WPP on October 1, 2026, and verified after a container restart. For future scans, confirm `admin:WORKING` with `waha:status`, compare `/api/sessions/admin/me` with the intended admin number, restart the container, and confirm the same number remains connected. No message needs to be sent for this verification.

This setup supplies the gateway. The application implements invitations, account creation, session ownership in D1, and campaign queues. The admin session will send invitations and admin campaigns. Each invited account will connect its own WhatsApp session after account setup and may use a marketing number different from its login number. The backend must select sessions using the authenticated account's stored ownership.
