# Activate the backend on Cloudflare

The backend is implemented and tested locally. Live order storage requires a real D1 database and staff secret. Do not deploy with the all-zero database ID in wrangler.jsonc.

## 1. Create the production database

From the repository root, enter the backend folder first:

```powershell
Set-Location "Jaana Backend"
npm.cmd install
npx.cmd wrangler login
npx.cmd wrangler d1 create jaana-orders
```

Replace the all-zero database_id in wrangler.jsonc with the ID printed by the last command. Keep the binding name DB. Set name to your actual Cloudflare Pages project name if it differs from jaana-logistics. A database ID is configuration, not a secret, and may be committed.

## 2. Create production tables

After replacing the database ID:

```powershell
npx.cmd wrangler d1 execute DB --remote --file migrations/0001_orders.sql
```

This initial schema creates missing tables without erasing existing orders. The --local flag targets your development database instead.

## 3. Set the production staff token

Generate a private token:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save it in the company's password manager. Do not put it in Git, source code, a URL or chat. Set it as an encrypted Pages secret through the Cloudflare dashboard, or run:

```powershell
npx.cmd wrangler pages secret put ADMIN_API_TOKEN --project-name YOUR-PAGES-PROJECT
```

Replace YOUR-PAGES-PROJECT and enter the token at the hidden prompt. Use a different token from local development. Staff access fails closed if the secret is absent or shorter than 32 characters. Never commit .dev.vars.

## 4. Update Pages build settings

| Setting | Value |
| --- | --- |
| Framework | None |
| Build command | npm run build |
| Build output | dist |
| Root directory | Jaana Backend |
| Production branch | Your production branch, usually main |

Pages installs and builds from `Jaana Backend`, compiles its `functions/` directory and reads its DB binding from `wrangler.jsonc`. The build script includes the customer HTML/CSS/JavaScript and images from the parent folder, plus the staff interface from this folder. Public URLs stay `/api/...` and `/admin.html`. Commit the code, package-lock.json and real database configuration, then push and redeploy. Check the deployed project's bindings before accepting orders. Use a separate test database and secret if enabling backend access in preview deployments.

The output directory is `dist`, relative to `Jaana Backend` (the full repository path is `Jaana Backend/dist`). Do not publish the repository root as the static output: dist/ deliberately contains public assets only.

## 5. Test the public HTTPS site

1. Submit a clearly marked test booking and save its reference.
2. Open /admin.html and sign in with the production staff token.
3. Find the test request and change its status to Booking confirmed.
4. Check the reference through Delivery Updates, including from another device.
5. Sign out of the staff page and confirm customer data disappears.

If the API is not configured, check the DB binding and redeploy. If storage fails, check the migration was applied to the same database ID. If staff sign-in fails, check the production secret and redeploy.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/bookings | Save a validated request; requires an Idempotency-Key header |
| POST | /api/delivery-status | Lookup using a reference; returns status only |
| GET | /api/admin/bookings?page=1 | Staff list; requires Authorization: Bearer TOKEN |
| PATCH | /api/admin/status | Staff update using reference, status and version |

Initial limits: 10 booking attempts per IP per 10 minutes, 30 status lookups per IP per minute, and 60 staff attempts per IP per minute. Request bodies are limited to 16 KB.

The shared staff token grants access to all orders; this version has no individual staff accounts, payments, automatic notifications or live GPS tracking. The business should decide its order-retention period and who may access production records.

Official references:
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.cloudflare.com/pages/functions/routing/
