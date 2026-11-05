# Reliability and security rollout

These changes are local source changes. They do not publish a release or change the production database, staff accounts, provider quotas, or Cloudflare account settings.

## Apply and verify in staging first

Run inside `Jaana Backend`:

```powershell
npm.cmd install
npm.cmd run db:local
npm.cmd test
npm.cmd run test:performance
npm.cmd run build
npm.cmd run dev
```

Use `wrangler.jsonc` as the only active Wrangler configuration. The earlier TOML is retained as `docs/wrangler-previous.toml.example` for reference and is not loaded. Default local and remote D1 commands use the same DB binding; `--local` and `--remote` select different databases. Confirm the database ID before remote operations. New migrations 0005 and 0006 preserve orders and add indexes, request hashes, search indexing, encrypted MFA setup, and recovery-code tables. Back up production first and measure the FTS rebuild on a staging copy before rollout; it indexes existing bookings and can take time on large databases.

Before publishing, apply migrations to the intended production database:

```powershell
npx.cmd wrangler d1 migrations apply DB --remote
```

Follow your existing Pages deployment workflow. Use a separate preview database and test accounts for staging.

## Required configuration

The untracked `.dev.vars` file configures local development only. Set production secrets separately in Cloudflare Pages, then redeploy:

- `GEOAPIFY_API_KEY`: provider key, restricted and monitored using the provider controls available to your account.
- `LOCATION_SIGNING_SECRET`: at least 32 characters of randomly generated material. Signed address selections expire after 15 minutes.
- `MFA_ENCRYPTION_KEY`: a different randomly generated secret of at least 32 characters. Authenticator secrets are encrypted with AES-GCM before storage. Back this key up privately; changing or losing it prevents existing authenticators from being verified. Do not rotate it without an account re-enrollment/recovery plan.

Generate each random secret independently with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` in your own terminal. Never paste secrets into commits, issues, screenshots, or test reports.

Non-secret settings:

- `REQUIRE_STAFF_MFA=true`: after installing migrations and configuring the encryption key, require all staff to enroll before reading or changing protected data. Existing staff can sign in and access authenticator settings to enroll. The code default is false so an unconfigured rollout does not unexpectedly lock out existing operations. Production activation is an explicit rollout step, not a claim that MFA is already enforced live.
- `LOCATION_DAILY_LIMIT=1000`: default application-wide maximum upstream autocomplete calls per UTC day across all visitor IPs. Adjust to your provider allowance and expected usage. `ROUTING_DAILY_LIMIT=1000` separately caps upstream route calls across all IPs, including new booking recalculations; saved-booking retries do not spend that allowance. Both limits still need provider-side quotas/alerts.
- `LOCATION_CACHE_SECONDS=0`: disabled by default. Enable only if your provider agreement permits caching; maximum 300 seconds. Cached provider results are never signed tokens. Each accepted response receives fresh tokens. Browser-facing responses remain `Cache-Control: no-store`.

## Staff MFA and recovery

Sign in, change any temporary password, then choose **Authenticator & recovery**. Enter the current password, add the setup key manually to an authenticator app (JAANA Logistics, six digits, 30 seconds), and verify the generated code. Enrollment expires after ten minutes if unfinished. MFA activation revokes every existing session. Save the eight recovery codes privately before leaving the dialog. Recovery codes are stored only as hashes on the server, never in browser storage, and each works once with the password.

Sign in using the password plus either a current authenticator code or an unused recovery code. Replayed authenticator time steps are rejected. Wait for a new code after enabling MFA. Recovery codes do not reset a forgotten password.

If someone forgets a password, another administrator independently verifies their identity and uses **Staff accounts → Reset password**. If their authenticator and recovery codes are lost, use **Reset authenticator**, record the verification method, and require re-enrollment. A staff member cannot use this administrator action to remove their own MFA. Disable unused/demo accounts after confirming they are not needed; no account is silently deleted by this release.

For the sole administrator, the Cloudflare database owner has an emergency procedure:

```powershell
npm.cmd run staff:recover
# Review the generated file and verify the intended target/database.
npx.cmd wrangler d1 execute DB --remote --file .staff-recovery.sql
Remove-Item -LiteralPath .staff-recovery.sql
```

This owner-only tool generates SQL; it does not execute it. It targets one existing email, sets a temporary password, removes its MFA, revokes sessions/recovery codes, and adds an owner-attributed audit entry. Use `--local` for local recovery. The SQL file is ignored by Git. This is not a public unauthenticated password-reset endpoint. Keep database-owner access protected by MFA. If a self-service email recovery flow is later desired, it requires a configured and verified mail delivery service.

Login throttling is per IP plus account/IP pair, so another network cannot exhaust a victim's account-wide allowance. Shared-network users can still be affected by an IP limit. Required MFA plus Cloudflare edge abuse/bot controls are needed against distributed credential guessing. Review available edge controls rather than claiming per-IP limits prevent DDoS.

## Database performance

Cleanup deletes no more than 50 expired rate-limit rows per request and uses an expiry index. Status/date queries use covering indexes. Dashboard totals use indexed subqueries rather than reading each order's full payload. Search uses indexed word/phrase prefixes: `customer 22` matches that phrase with the last word allowed as a prefix. It no longer promises arbitrary middle-of-word matches. Searches consisting only of symbols use a literal fallback. Booking/status functionality remains unchanged.

`npm run test:performance` uses synthetic data in an in-memory SQLite database (10,000 orders and 10,000 expired buckets), prints query plans and p95 timings, and never contacts production or Geoapify. These numbers are local regression evidence, not production capacity. Before release, compare staging timings, Cloudflare D1 row-read/write metrics, storage usage, and current plan limits with representative queries and expected concurrency. Do not load-test customer data or a paid address provider without an explicit budget.

Official references: https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/ .

## Headers, origins and missing pages

Static pages receive CSP, frame protection, permissions restrictions and a one-day HSTS policy scoped to the current host (no includeSubDomains or preload). CSP restricts scripts and network connections to the same origin; inline styles remain allowed for existing dynamic layout changes. Geoapify requests are server-side. API responses set their own restrictive CSP and no-store headers because Pages `_headers` does not cover Functions.

Confirm HTTPS works on each production hostname before deploying the HSTS policy. Do not expand its duration, includeSubDomains or preload scope without validating every affected hostname. Check response headers in the live environment after deployment; local verification cannot prove edge/custom-domain behavior.

The top-level `404.html` prevents the Pages single-page fallback. Unknown API routes retain JSON 404 responses. The Google verification file is explicitly packaged. No placeholder robots, sitemap or security-contact files were invented. Public HTML has wildcard CORS removed. APIs are same-origin: an unrelated Origin is rejected; staff cookies are HttpOnly and SameSite=Strict. CORS is not a substitute for authentication, and non-browser clients still need authorization.

Official reference: https://developers.cloudflare.com/pages/configuration/headers/ . TOTP follows https://www.rfc-editor.org/rfc/rfc6238 .

## Acceptance checks after deployment

1. Book a test shipment, repeat its identical idempotency key after changing prices or expiring its location tokens, and confirm the saved reference is returned. Changing actual booking fields with the same key must return 409.
2. Select addresses, calculate, adjust the weight above 20 kg, and check that WhatsApp contains the current fields and no obsolete estimate or proof tokens.
3. Leave an address field while a search is pending. Suggestions must stay closed. Simulate provider errors and check the customer sees an explanation.
4. Enroll a test staff account, verify password-plus-code sign-in, replay rejection, one-time recovery, session revocation, password reset and administrator-assisted recovery. Activate `REQUIRE_STAFF_MFA=true` after confirming the configuration.
5. Request a real page, a fabricated static path, and an unknown API path. Expect 200, 404, 404. Check CSP/HSTS/no-store headers and foreign-Origin rejection.
6. Check the provider dashboard quotas and available alerts, set a suitable application daily budget, monitor errors and route usage, and confirm preview settings do not point to production customer data.

## Booking retry and saved-price behavior

Pending booking attempts now retain a canonical request fingerprint and idempotency key in sessionStorage before submission. Reopening the booking form or recalculating a quote reuses the key when the actual booking details are unchanged; refreshed location tokens, road distance and estimate text do not create a new booking identity. Successful submission clears the stored attempt and drafts. Starting another booking resets the identity. If browser storage is blocked, only retries within the current page can retain their key.

Booking responses include the saved shipment/pricing breakdown, including for duplicate retries. The customer form and WhatsApp message use this saved breakdown, with a visible notice if verification changed the estimate. A saved request remains subject to JAANA confirmation; this is not a payment authorization or fixed-price reservation.

MFA settings return a validation error for an incorrect current password or second-factor code while preserving a valid session. Actual expired/invalid sessions still return 401. Failed MFA login attempts create `auth.mfa_failed` audit entries containing staff attribution, without passwords, authenticator codes, recovery codes or secrets.
