# Re-Target

Re-Target is an invite-only customer outreach application for businesses in Bangladesh. It imports customers from delivered Pathao and Steadfast shipments, organizes account-owned leads, and sends personalized WhatsApp campaigns.

Built with **Astro**, **TypeScript**, **Cloudflare Workers**, **D1**, **Drizzle ORM**, and **R2**. WhatsApp delivery uses a separately hosted WAHA gateway; uploaded media is validated by an authenticated Node service.

## Features

- **Invite-only accounts:** admins send invitations through WhatsApp; businesses set their company name and password through a one-time link.
- **Business isolation:** each account owns its courier connections, leads, media, WhatsApp session, and campaigns.
- **Courier imports:** Pathao token renewal and Steadfast remember-me sessions reuse encrypted credentials and sessions.
- **Lead management:** cross-courier deduplication within an account, delivery history, filters, WhatsApp checks, and contact preferences.
- **Personalized campaigns:** Bangla and Unicode messages, ordered images and videos, audience previews, immediate or scheduled delivery, and optional test destinations.
- **Background delivery:** queues, sender pacing, daily budgets, cooldowns, opt-outs, progress tracking, and explicit recovery for uncertain sends.
- **Responsive dashboards:** admin and business workspaces with mobile and desktop layouts.

WhatsApp is the implemented outreach channel. imo and “other” remain future scope. There is no public registration page.

## Architecture

```text
Browser → Astro SSR on Cloudflare Workers
                      ├── D1: accounts, sessions, leads, campaign state
                      ├── Private R2: original and prepared media
                      ├── Queues + scheduled recovery: imports and delivery
                      ├── Pathao / Steadfast: merchant portals
                      └── Protected HTTPS services
                           ├── WAHA: account-owned WhatsApp sessions
                           └── Media preparation: image/video normalization
```

An optional authenticated Node relay supports Steadfast when direct Worker requests are blocked. Cloudflare Access service authentication protects the hosted WAHA and media services, in addition to their application credentials.

**Localhost uses the same production D1 database, R2 bucket, and remote queue producers as the deployed application.** Changes made through the development app affect live records and may trigger real background work. The project deliberately has no local application database, copied production dataset, or staging environment. Automated tests use synthetic data and in-memory mocks.

## Requirements

- Node.js 24, as specified in `.nvmrc`, and npm.
- Access to the configured Cloudflare account, D1 database, R2 bucket, queues, and custom domain.
- The existing production secrets for local development.
- FFmpeg and FFprobe on `PATH` for media tests or native media service development.
- Docker Desktop and `cloudflared` for the included Mac-hosted gateway setup.

The supplied infrastructure is configured for the existing deployment. Cloudflare account/resource IDs and hostnames in `wrangler.jsonc` are configuration identifiers, not authentication credentials. To deploy under another owner, update these identifiers and `astro.config.mjs` together, and provision one shared database and bucket for that installation.

## Getting started

```sh
nvm use
npm ci
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Skip the copy if `.dev.vars` already exists. Fill it with the existing production values; do not generate a different courier encryption key for a database containing encrypted records. Authenticate Cloudflare with `npx wrangler login` or a suitably scoped private API token.

```sh
npm run verify
npm run dev
```

Open [localhost:4321](http://localhost:4321). Development runs in Astro's background mode.

```sh
npm run astro -- dev status
npm run dev:logs
npm run dev:stop
```

Log in with the configured admin phone and password. Connect the admin WhatsApp session, then invite a business from **Users**. Businesses accept their invitation, sign in, connect their courier and WhatsApp accounts, import leads, and create a campaign. Phone fields display and accept the local Bangladesh format `01XXXXXXXXX`.

## Configuration

Secrets belong in ignored local files and Cloudflare Worker secrets, never in source code or browser variables. `.dev.vars.example` contains placeholders only.

| Secret | Purpose |
| --- | --- |
| `ADMIN_PHONE` | Admin login number in local 11-digit format |
| `ADMIN_PASSWORD_HASH` | Salted password verifier; plaintext passwords are not accepted |
| `ADMIN_API_TOKEN` | Administrative product API bearer token; at least 32 characters |
| `COURIER_ENCRYPTION_KEY` | Stable 32-byte key represented as 64 lowercase hexadecimal characters |
| `WAHA_BASE_URL` | Protected HTTPS gateway origin; HTTP is permitted only on loopback |
| `WAHA_API_KEY` | Gateway API credential |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Backend Cloudflare Access service credentials |
| `WHATSAPP_WEBHOOK_SECRET` | Stable webhook signing secret; at least 32 characters |
| `MEDIA_PREPARATION_KEY` | Shared media-service bearer secret; at least 32 characters |
| `CAMPAIGN_TEST_NUMBERS` | Private admin default test destinations; business destinations are account-owned |

Optional `STEADFAST_TRANSPORT_URL` and `STEADFAST_TRANSPORT_TOKEN` enable the HTTPS relay. Configure both or neither. Public deployment settings, including `CAMPAIGN_MEDIA_ORIGIN` and `MEDIA_PREPARATION_URL`, live in `wrangler.jsonc`; local overrides may be supplied privately.

New password verifiers use `scrypt:16384:8:5:<32-hex salt>:<64-hex hash>`. Existing `pbkdf2-sha256:100000:…` verifiers remain compatible and upgrade after successful login. `scripts/password-hash.mjs` exports a matching Node generator for private configuration tooling. Rotating the configured admin verifier resets the saved admin password to the configured recovery credential and invalidates previous admin sessions.

Keep courier encryption-key backups with the encrypted-data backups. Replacing the key without decrypting and re-encrypting existing rows makes those records unreadable. Coordinate gateway, Access, webhook, and media-key rotations across all services.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the background development server |
| `npm run check` | Generate Worker types and check Astro/TypeScript |
| `npm run security:check` | Check candidate Git files for private paths and recognizable credentials |
| `npm run verify` / `npm test` | Upload checks, types, relay build, and automated tests |
| `npm run build` | Apply the dependency mitigation and build the Worker |
| `npm run deploy:check` | Build and perform a deployment dry run |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate:production` | Apply migrations to the live database |
| `npm run deploy` | Validate, provision missing resources, back up, migrate, publish, and verify |

`verify` installs the media service's locked dependencies before testing. Tests do not use production credentials or send real invitations/campaigns. The isolated password-runtime test uses workerd without application storage bindings.

## Deployment

Run `npm run deploy` only when ready to update the live application. The deployment script validates the build and tests, checks resources and required secrets, exports a database backup before migration, publishes a unique deployment ID, and checks the live site's storage health and API protection. Existing remote secrets are preserved; changing a private local file alone does not rotate them.

Local bootstrap values are kept in the ignored `.deploy/production-secrets.json`. All required secrets must exist remotely or be supplied through this private file or the process environment. Successful local releases are recorded in `.deploy/last-success.json`.

GitHub provides:

- **Check:** runs on pushes and pull requests; validates types, tests, and the deployment dry run without production secrets.
- **Deploy:** manually triggered, uses the `production` environment, and serializes deployments. Configure environment restrictions in GitHub for your release policy.

Set `CLOUDFLARE_API_TOKEN` and any missing Worker bootstrap secrets in GitHub's protected secrets. **CI deployment also requires `DATABASE_BACKUP_PUBLIC_KEY`**, an RSA public key of at least 2048 bits. Generate a 3072-bit key pair on a trusted machine:

```sh
umask 077
mkdir -p .deploy
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out .deploy/backup-private.pem
openssl pkey -in .deploy/backup-private.pem -pubout -out .deploy/backup-public.pem
```

Store the public PEM as `DATABASE_BACKUP_PUBLIC_KEY`; keep the private PEM offline. CI backups are encrypted with AES-256-GCM and RSA-OAEP-SHA256 before upload. The workflow uploads only `*.encrypted.json`, retained for seven days. Local SQL backups are owner-only and ignored; encrypt them before moving them elsewhere. See [backup recovery](docs/backup-recovery.md).

## Security

- Random session tokens and invitation tokens are stored as hashes. Sessions expire after eight hours and use HttpOnly, SameSite=Lax cookies with Secure on HTTPS.
- Invitations expire after 72 hours and accept atomically once. Password changes and credential upgrades invalidate older account sessions.
- Login attempts are limited atomically in D1. Cookie-authenticated writes require a same-origin request.
- SQL queries use bound values; account-owned resources are filtered by authenticated ownership.
- Courier credentials and sessions use AES-256-GCM with account/provider binding.
- Webhooks require SHA-512 HMAC signatures; delivery media uses short-lived signed URLs backed by private R2 objects.
- Browser responses receive CSP, clickjacking protection, MIME protection, restricted permissions, and HSTS over HTTPS. Scripts are emitted as external assets to work with the CSP.
- Uploads, gateway responses, and relay payloads are bounded. The relay permits only approved Steadfast routes.

The dependency `http-cache-semantics@4.2.0` has [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), with no patched registry release at review time. A checksum-verified local mitigation forces revalidation of non-cacheable and zero-lifetime entries. It runs at install/build and has regression coverage. **`npm audit` still reports this advisory and its two inherited dependency findings** because registry metadata cannot detect local patches. Do not use `npm audit fix --force` to downgrade Astro. Review and remove the mitigation when an upstream fix becomes available.

See [SECURITY.md](SECURITY.md) for reporting, review scope, operational responsibilities, and remaining limitations.

## Preparing a GitHub upload

Use Git to select files; uploading a folder archive does not honor `.gitignore`.

```sh
git init
npm run security:check
git add .
npm run security:check
git diff --cached --stat
```

Review staged files before committing. Never upload `.dev.vars`, real `.env` files, `.deploy`, `.waha`, database/session backups, private keys, generated builds, or screenshots containing customer data or pairing codes. The upload check includes tracked files, so it also catches private files that were already added despite ignore rules. It is a safeguard, not a complete secret scanner or history audit. Rotate any credential previously published; deleting a file does not remove it from Git history.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/pages/` | Login, invitation onboarding, dashboards, and API routes |
| `src/lib/` | Authentication, courier adapters, imports, campaign logic, and shared UI behavior |
| `src/components/`, `src/layouts/` | Astro UI components and page shells |
| `src/db/`, `migrations/` | Drizzle schema and versioned SQL migrations |
| `src/worker.ts` | Worker fetch, queue consumers, and scheduled recovery |
| `src/middleware.ts` | Administrative API authentication and response protections |
| `infra/` | WAHA, media preparation, and optional Steadfast relay |
| `scripts/` | Verification, deployment, backup encryption, and service operations |
| `tests/` | Synthetic integration and regression tests |
| `.github/workflows/` | CI and manual deployment |

## Further documentation

- [Campaign operations](docs/campaign-operations.md)
- [WAHA setup and recovery](infra/waha/README.md)
- [Media preparation](infra/media-preparation/README.md)
- [Pathao integration](pathao-api-doc.md)
- [Steadfast integration and relay](steadfast-api-doc.md)
- [Astro documentation](https://docs.astro.build)

## License

No license is currently granted for this application. Add an explicit license before distributing it for third-party use. Dependencies retain their respective licenses.
