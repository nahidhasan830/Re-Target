# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner. Once hosted on GitHub, use private vulnerability reporting if enabled. Do not publish credentials, customer information, invitation links, signed media URLs, or exploit details in a public issue. Include the affected route/component, a minimal reproduction with synthetic data, and the expected security boundary.

Only the current maintained deployment is supported. This repository has no independent security certification or guarantee of being vulnerability-free.

## Review performed: 3 October 2026

The source review covered authentication, invitation acceptance, account authorization, CSRF checks, database queries, courier encryption, webhooks, private media, external service calls, local secret exclusions, dependency advisories, and CI/deployment handling.

| Finding | Remediation |
| --- | --- |
| Legacy PBKDF2 verifiers have a lower work factor than modern password-storage guidance | New verifiers use scrypt with N=16384, r=8, p=5; successful legacy logins upgrade through conditional writes and invalidate old sessions. Strict format validation rejects malformed hashes. |
| Administrative middleware can miss percent-encoded route spellings | Decode the pathname before matching protected API routes; regression tests cover encoded aliases. |
| Security-zeroed cached responses can be reused by a vulnerable transitive package | Checksum-verified local patch rejects non-cacheable/zero-lifetime hits. Tests cover max-stale with private, no-store, no-cache, and Set-Cookie responses. |
| CI uploaded full plaintext database backups | CI requires an RSA public key before deployment begins; backups use authenticated hybrid encryption. Only encrypted files are uploaded. |
| Missing browser policy and transport hardening | Added CSP, HTTPS HSTS, Permissions-Policy, external script emission, gateway origin/HTTPS checks, and bounded gateway JSON parsing. |
| Media service accepted a raw credential without a Bearer scheme | Require the exact Bearer scheme and test raw/Basic/wrong credentials. |
| Screenshots and operational data could enter the first Git upload | Ignore private review artifacts, screenshots, verification data, keys, logs, and local database files; scan Git candidates including already tracked files. |
| Public configuration exposed operational phone numbers | Move admin/test numbers to private Worker/local settings; use synthetic numbers in test fixtures. |
| Workflow actions used mutable version tags | Pin checkout, Node setup, and artifact upload actions to verified commit hashes. |

No plaintext credentials were found among the upload candidates by the local check. Existing private configuration files were preserved. The folder had no Git metadata at review time, so prior commits, remote history, and past credential exposure could not be inspected.

## Known dependency advisory

`npm audit` reports three high-severity package entries arising from the single [http-cache-semantics advisory GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). There was no patched npm release at review time. Astro imports this package for remote image cache policy; the application does not use it as an authenticated response cache.

`scripts/patch-cache-policy.mjs` mitigates the unsafe cache reuse in the installed package. It validates the full source checksum, applies an idempotent guard, and fails on an unexpected dependency change. The mitigation runs through `postinstall` and before production builds. Run it explicitly if installing with scripts disabled. Audit metadata still flags the original version; this is not a clean audit result. Review updates instead of suppressing or deleting the warning.

## Operational responsibilities and limits

- Deploy the reviewed source before expecting these changes in production. This review did not deploy, send outreach, or modify production application records.
- Existing PBKDF2 verifiers upgrade when their owners next log in or change passwords. Dormant accounts retain legacy verifiers until then; the configured admin recovery verifier may also remain legacy until separately rotated.
- Protect live application access with HTTPS. Keep the WAHA/media Access policies restricted to the backend service token, and keep their service ports bound to loopback. Code review does not prove deployed firewall or Access rules are correct.
- Login throttling relies on Cloudflare's `CF-Connecting-IP` on the deployed Worker. Restrict any intermediary Worker routes appropriately. Apply edge limits for traffic that would otherwise consume database resources before authentication.
- Developer access is privileged: localhost connects to production storage and queues. Use trusted machines and avoid real writes or outreach during automated testing.
- Store Cloudflare, Vercel, courier, gateway, signing, encryption, and backup credentials outside source control. Coordinate rotations across services. Never replace the courier encryption key without a data re-encryption plan.
- Store the CI backup private key offline. An encrypted artifact cannot be recovered without it. Restrict repository/deployment access and retain separate verified backups.
- Invitation and signed media links are bearer capabilities. Keep them private and avoid URL logging that exposes tokens. Assess the provider/platform's request-log access and retention; application error logs intentionally omit private payloads.
- Upload normalization and container restrictions reduce risk but do not replace timely Sharp/FFmpeg/container updates. Storage quotas and edge abuse controls depend on deployment policy.
- The upload check recognizes private paths, a small set of token patterns, and copies of secrets known on the local machine. It does not detect every secret format, inspect screenshots, or scan history. Enable GitHub secret scanning/push protection where available.

## Validation

`npm run verify` checks types and executes synthetic tests, including password upgrades, login throttling, CSRF rejection, encoded-path protection, gateway rejection, cache-policy mitigation, and encrypted backup recovery. The password implementation is exercised in workerd with no application storage bindings. Existing tests cover tenant isolation, courier encryption ownership, signed webhook forgery, media access, and campaign replay/concurrency behavior.

`npm run deploy:check` validates the production build and deployment dry run. Live infrastructure penetration testing, existing remote settings, prior repository history, and a real delivery pilot are outside this source review.
