# Campaign media preparation

This authenticated Node service decodes and normalizes campaign uploads before the Worker marks private R2 assets ready. It accepts bounded JPEG/PNG/MP4 bytes at `POST /prepare`; it never fetches browser-supplied URLs. Images become metadata-free JPEGs. Videos are probed and converted to H.264/AAC MP4 with fast-start metadata. Up to two preparations run at once; overload returns 429.

The service is hosted in Docker on the same Mac as WAHA, at `127.0.0.1:3001`. Production requests use `https://media.nahidlabs.com`, protected by a dedicated Cloudflare Access application accepting the existing backend service token. Bearer authentication with `MEDIA_PREPARATION_KEY` is also required. The shared `re-target-waha` tunnel carries both routes; setup preserves other routes.

```sh
npm run media:up
npm run media:status
npm run media:cloudflare
npm run media:verify
npm run media:verify -- --remote
npm run media:stop
```

`media:up` builds and starts the container with a private key copied from `.deploy/production-secrets.json` into the ignored, owner-only `infra/media-preparation/.env`. `media:cloudflare` provisions the narrow Access policy, tunnel route and DNS record, then configures `.dev.vars`. The production URL is configured in `wrangler.jsonc`; deploy application updates through `npm run deploy`. Existing application secrets are preserved.

Docker's `unless-stopped` policy restarts the service once Docker Desktop starts. Keep the Mac powered, awake, online, and the gateway tunnel running. Start the tunnel with `npm run waha:tunnel` if needed. Docker Desktop's startup-at-login setting controls recovery after reboot.

For native service development, install Node 24, FFmpeg and FFprobe on PATH, then use `npm run media:install` and `npm run media:start` with the preparation key supplied privately in the process environment. The service defaults to port 3001. The Astro app uses its prescribed background mode and the production-reachable preparation URL with shared storage.

The Worker rejects redirects, limits response size and verifies the preparation checksum before storing the result. The service uses temporary files under `/tmp`, cleans them after completion and runs as an unprivileged container user. Source uploads and secrets must not be logged. Images are limited to 5 MB; videos to 100 MB and five minutes.

Run `npm test --prefix infra/media-preparation` for decoder/transcoder checks. `media:verify` checks authentication plus synthetic PNG and MP4 preparation and checksums without writing application data or sending messages. `--remote` also verifies both authentication layers on the protected route.

The container build/start and local/protected remote preparation were verified on 2 October 2026.
