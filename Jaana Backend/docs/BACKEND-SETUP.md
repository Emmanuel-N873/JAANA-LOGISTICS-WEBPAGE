# Activate the backend on Cloudflare

The backend is implemented and tested locally. Live order storage requires a real D1 database and an individual administrator account. Do not deploy with the all-zero database ID in wrangler.jsonc.

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
npx.cmd wrangler d1 migrations apply DB --remote
```

This initial schema creates missing tables without erasing existing orders. The --local flag targets your development database instead.

## 3. Create the first administrator

Follow [STAFF-ACCOUNTS.md](STAFF-ACCOUNTS.md) to generate and apply a first-administrator setup file. Sign-in now uses individual email/password accounts and HttpOnly session cookies. The old shared ADMIN_API_TOKEN is no longer accepted. Keep separate administrator passwords for development and production.

## 4. Update Pages build settings

| Setting | Value |
| --- | --- |
| Framework | None |
| Build command | npm run build |
| Build output | dist |
| Root directory | Jaana Backend |
| Production branch | Your production branch, usually main |

Pages installs and builds from `Jaana Backend`, compiles its `functions/` directory and reads its DB binding from `wrangler.jsonc`. The build script includes the customer HTML/CSS/JavaScript and images from the parent folder, plus the staff interface from dashboard/ and the routing/header configuration from public/. Public URLs stay `/api/...` and `/admin.html`. Commit the code, package-lock.json and real database configuration, then push and redeploy. Check the deployed project's bindings before accepting orders. Use a separate test database and staff accounts if enabling backend access in preview deployments.

The output directory is `dist`, relative to `Jaana Backend` (the full repository path is `Jaana Backend/dist`). Do not publish the repository root as the static output: dist/ deliberately contains public assets only.

## 5. Test the public HTTPS site

1. Submit a clearly marked test booking and save its reference.
2. Open /admin.html and sign in with the administrator email and password.
3. Find the test request and change its status to Booking confirmed.
4. Check the reference through Delivery Updates, including from another device.
5. Sign out of the staff page and confirm customer data disappears.

If the API is not configured, check the DB binding and redeploy. If storage fails, check the migration was applied to the same database ID. If staff sign-in fails, check the account migration, administrator setup and active account state.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/bookings | Save a validated request; requires an Idempotency-Key header |
| POST | /api/delivery-status | Lookup using a reference; returns status only |
| GET | /api/admin/bookings?page=1 | Searchable, paginated staff list and dashboard totals; requires a signed-in staff session |
| GET | /api/admin/order?reference=REFERENCE | Staff-only order details and status history |
| PATCH | /api/admin/status | Staff update using reference, status and version |
| GET/POST | /api/staff | Individual sign-in, current identity, password change and sign-out |
| GET/POST | /api/admin/staff | Administrator account management |
| GET | /api/admin/activity | Administrator activity search |

Initial limits: 10 booking attempts per IP per 10 minutes, 30 status lookups per IP per minute, and 60 staff attempts per IP per minute. Request bodies are limited to 16 KB.

The staff list accepts `q` (reference, customer name or address), `status`, `area` (pickup or destination address), and `date` (requested delivery date, YYYY-MM-DD). Filters combine and apply before pagination, with 20 orders per page. Dashboard totals cover all saved orders, regardless of filters; Completed today uses the Lagos date. In progress includes picked-up and in-transit orders; Pending requests counts requests awaiting confirmation.

Open **Staff Dashboard** in the website footer, then sign in. Use **View** to inspect customer and recipient details, addresses, package information and timestamped status history. Save a status from the details dialog; conflicting updates reload the latest order for review. Signing out clears displayed customer data and ignores responses from older sessions. The mobile sidebar opens with the menu button. No database migration is needed for these dashboard improvements.

Individual staff accounts grant access according to role. This version has no payments, automatic notifications or live GPS tracking. The business should decide its order-retention period and who may access production records.

Official references:
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.cloudflare.com/pages/functions/routing/
