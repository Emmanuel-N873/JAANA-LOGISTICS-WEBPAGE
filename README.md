# JAANA Logistics

JAANA Logistics company website with a dedicated delivery rate calculator, online delivery requests, customer status lookup, and a staff dashboard. The application uses HTML, CSS and JavaScript, Cloudflare Pages Functions, and a Cloudflare D1 database.

Customers can request deliveries and save their booking references. Staff sign in with individual accounts to manage orders, while administrators manage staff access and review activity records.

## Reliability and security updates

See [the rollout and recovery guide](<Jaana Backend/docs/RELIABILITY-SECURITY.md>) before deploying migrations 0005 and 0006. It covers the authoritative `wrangler.jsonc` configuration, required signing/encryption secrets, MFA activation, staff recovery, provider budgets, search changes, security headers and staging verification.

For a beginner-friendly backend walkthrough, read [the backend guide](<Jaana Backend/docs/BACKEND-GUIDE.md>) before changing API routes, authentication or database migrations.

## Reading the frontend

Start with [the frontend guide](docs/FRONTEND-GUIDE.md). It explains each script, browser storage, staff events, and the calculator-to-booking flow. Run `npm.cmd run check:frontend` inside `Jaana Backend` to check formatting, or `npm.cmd run format:frontend` to format frontend source.

## Project layout

```text
JAANA DELIVERY WEB PAGE/
  index.html                   # Homepage and original booking dialog
  calculator.html              # Separate delivery rate calculator
  favicon.ico
  README.md
  .gitignore
  assets/
    css/                       # Shared design system and website styles
    js/                        # Customer-facing JavaScript
    images/                    # Published brand, hero and service images
      services/
  docs/
    design/
      references/              # Original design references (not published)
      prompts/                 # Image-generation prompts (not published)
  Jaana Backend/
    dashboard/                 # Staff interface source
      admin.html
      css/
      js/
    functions/api/             # Cloudflare API routes
      admin/                   # Protected staff/admin endpoints
    server/                    # Shared server validation and authentication
    migrations/                # Ordered D1 database migrations
    scripts/                   # Build and administrator setup tools
    tests/                     # Backend verification
    docs/                      # Deployment and staff-account guides
    public/                    # Cloudflare headers and routing rules
    package.json
    package-lock.json
    wrangler.jsonc
    .dev.vars.example
    .dev.vars                  # Ignored local secrets
    node_modules/              # Ignored dependencies
    .wrangler/                 # Ignored local runtime/database state
    dist/                      # Ignored generated deployment output
```

The landing page stays at the project root; customer-facing styles, scripts and images are grouped under assets/. Backend code, staff interface, database configuration, development dependencies, tests and backend setup instructions are grouped in `Jaana Backend`.

## Customer pages and delivery pricing

- `/index.html`: company homepage, services, contact information and delivery updates.
- `/calculator.html`: shipment addresses, package count, combined weight, package size and delivery estimate. Homepage **Book a Delivery** and quotation links open this page.
- **Continue to Booking** returns to `/index.html#booking` and opens the original booking template with the shipment details and estimate filled in. Package dimension fields are omitted from both forms.
- `/admin.html`: secured staff dashboard. Administrators can select **Delivery pricing** to change the rate per kilometre and minimum distance charge.

Default distance pricing is ?300 per kilometre with a ?2,000 minimum. The calculation is:

`max(minimum distance charge, ceil(road kilometres ? rate per kilometre)) + weight charge`

| Combined shipment weight | Additional charge |
| --- | --- |
| Up to 5 kg | ?0 |
| Over 5?10 kg | ?500 |
| Over 10?15 kg | ?1,000 |
| Over 15?20 kg | ?1,500 |
| Over 20 kg | Custom quotation required; automatic total stops |

Geoapify geocodes Nigerian addresses and calculates driving road distance. Customers can inspect their route through a Google Maps link. Estimates use current administrator pricing, and the booking endpoint recalculates the route and price rather than trusting customer-submitted amounts. JAANA still confirms the final quote and availability. Contact buttons open the company WhatsApp at +2348038422591.

## Run locally

Use Node.js 22.13 or newer (Node 24 recommended). In a terminal at the repository root:

```powershell
Set-Location "Jaana Backend"
npm.cmd install
npm.cmd run db:local
```

Configure the map service in `Jaana Backend/.dev.vars`. Create that file if it does not exist, or add this setting to the existing file while preserving other entries:

```ini
GEOAPIFY_API_KEY=your_actual_geoapify_key_here
LOCATION_SIGNING_SECRET=replace-with-an-independent-random-secret-of-at-least-32-characters
MFA_ENCRYPTION_KEY=replace-with-another-random-secret-of-at-least-32-characters
```

Replace the placeholder with your actual Geoapify key. Keep it server-side; `.dev.vars` is ignored by Git. Restart the development server after changing secrets. Without a working key, automatic estimates show a setup or provider error; WhatsApp contact remains available. See [calculator setup](<Jaana Backend/docs/CALCULATOR-SETUP.md>).

For a new local database, create the first administrator:

```powershell
npm.cmd run staff:bootstrap
npx.cmd wrangler d1 execute DB --local --file .staff-bootstrap.sql
Remove-Item -LiteralPath .staff-bootstrap.sql
```

The command asks for a name, email and password of at least 14 characters, with password entry hidden. The generated SQL creates the first administrator only when no staff accounts exist. Skip this step if your database already has staff accounts. See [the staff account guide](<Jaana Backend/docs/STAFF-ACCOUNTS.md>) for full instructions.

Start the application from the same backend directory:

```powershell
npm.cmd run dev
```

Sign-in uses individual email/password accounts; the old shared `ADMIN_API_TOKEN` is no longer accepted. No default account is included. Never commit local secrets or bootstrap SQL.

Open the address printed by Wrangler, normally http://127.0.0.1:8788. Staff orders are at `/admin.html`. Opening index.html directly or using Live Server does not run the API.

## Deploy

Follow [the backend setup guide](<Jaana Backend/docs/BACKEND-SETUP.md>). Confirm that `wrangler.jsonc` points to the intended company-owned D1 database, apply the migrations, and create a production administrator account. Local and production databases have separate accounts and data. Pages settings:

| Setting | Value |
| --- | --- |
| Root directory | Jaana Backend |
| Build command | npm run build |
| Build output directory | dist |

Set `GEOAPIFY_API_KEY` as a Cloudflare Pages secret for each deployed environment that needs routing; the local `.dev.vars` file does not configure production. Apply all ordered migrations, including `0004_pricing.sql`, before using the calculator and pricing controls.

The backend build includes the homepage, separate calculator page and assets/ from the parent folder. It maps dashboard/ source files to public staff asset URLs and copies configuration from public/. Live URLs remain `/api/bookings`, `/api/delivery-status`, `/api/admin/...` and `/admin.html`.

Deploy only the generated `Jaana Backend/dist/` output with its Pages Functions. The source dashboard HTML belongs in `dashboard/`; its public URL remains `/admin.html`. Rebuild after changing source files and confirm HTTPS before accepting live bookings. Production database setup and deployment are separate actions; running the local development command does not publish the website.

Before pushing a deployment, run `npm.cmd run build` followed by `npm.cmd run check:deployment` from `Jaana Backend`. The check is local-only: it verifies the generated files and routing configuration but does not publish the site or modify D1.

## Booking and staff workflow

Validated requests are saved in D1 with server-generated references and duplicate-request protection. Customers can copy the reference, check staff-maintained delivery status, or follow up on WhatsApp. The latest reference is stored in browser local storage. Shipment details and the estimate are temporarily stored in session storage to transfer between the calculator and booking form; starting another booking clears that draft. Submitted customer details and shipment information are saved in D1. JAANA confirms availability, pricing and bookings. No automatic reservations, payments or GPS tracking are performed. Older WhatsApp-only references are not in the database. WhatsApp quotation messages do not become saved orders unless a booking request is submitted.

The main navigation and website footer link to **Staff Dashboard**, which requires an individual staff account and a secure session cookie. The staff member's name, role and initials appear in the header. The responsive dashboard provides database totals, including cancelled orders, search by reference/customer/address, status/area/delivery-date filters, and pagination. Open an order to view full details, copy its reference, review its status history and save status updates with conflict checks and individual staff attribution. Signing out clears customer details and prevents old requests from changing a newer session.

| Role | Access |
| --- | --- |
| Staff | Search and view all bookings, inspect order details, update delivery statuses and change their own password |
| Administrator | Staff access plus delivery pricing changes, account creation, account changes, deactivation, password and authenticator recovery, and activity-log search |

New staff receive a temporary password and must change it before accessing bookings. Password resets and account changes revoke previous sessions. Sessions expire after eight hours. Use HTTPS, keep staff access private and deactivate accounts when staff leave.

## Activity records

The staff dashboard includes a booking-notification bell, individual unread counts, notification history, pop-up alerts and optional sound. It polls every 15 seconds while visible and stops on sign-out. Staff can explicitly acknowledge a booking; its first acknowledgement records the staff name and time without changing delivery status or marking other staff's alerts as read. Apply migration `0003_notifications.sql` before using these features. See [the notification guide](<Jaana Backend/docs/NOTIFICATIONS.md>) for activation and behaviour.

The backend records sign-ins, failed sign-in attempts, sign-outs, password changes, staff-account management, booking list/detail views, delivery pricing changes and status changes. Administrators can search the log by staff, action or reference. Delivery updates include the previous/new status, staff identity and timestamp, displayed in West Africa Time.

Audit records cannot be edited or deleted through the dashboard, and database triggers reject updates and deletes. They do not reconstruct who performed historical shared-token actions or independently verify browser-only actions. Failed sign-ins identify the attempted account. Passwords and session tokens are excluded from audit details. See [the account and audit guide](<Jaana Backend/docs/STAFF-ACCOUNTS.md>) for security details and limitations.

## Development commands

Run these inside `Jaana Backend`:

| Command | Purpose |
| --- | --- |
| `npm.cmd install` | Install backend development dependencies |
| `npm.cmd run db:local` | Apply ordered migrations to the local D1 database |
| `npm.cmd run staff:bootstrap` | Generate the first-administrator setup SQL |
| `npm.cmd run dev` | Build public assets and start the local Pages runtime |
| `npm.cmd test` | Run the backend test suite |
| `npm.cmd run build` | Generate deployment assets in `dist/` |

Edit source files in `assets/` and `Jaana Backend/dashboard/`; `dist/` is rebuilt automatically and should not be edited. Keep server helpers in `server/`, API endpoints in `functions/api/`, and database changes in new ordered migrations. Dependencies, local database state, local secrets and bootstrap SQL are ignored by Git.

## Company and assets

The user confirmed company contacts, coverage and displayed statistics on 13 October 2026. Contact: 0907 257 3328, WhatsApp 0803 842 2591, jaanadelivery@gmail.com, No. 20 Oyin Onibokun Crescent, Isheri-Osun, Lagos 102214. Working hours: Monday-Saturday, 9:00am-5:00pm WAT. This records user confirmation rather than an independent audit.

The supplied Company Logo.jpeg provides the company logo. Favicon, hero and service generation prompts are retained under docs/design/prompts/. Hero and service images are generated illustrations, not actual staff photographs. The coverage SVG is schematic. Original reference images are retained in docs/design/references/ and excluded from the public build.

The slideshow advances every two seconds, supports manual/keyboard/touch controls, pauses for hover/focus and respects reduced motion. Social links use the supplied company URLs.

## Verification

Run these commands inside `Jaana Backend`:

```powershell
npm.cmd test
npm.cmd run build
```

The backend suite covers SQL persistence, retries, references, validation, rate limits, staff authentication, public-data privacy, audit events, stale-update conflicts, administrator pricing permissions, weight tiers, shipment storage and mocked Geoapify geocoding/routing. Provider mocks verify metre-to-kilometre conversion and server-side recalculation of booking prices.

Run the test suite for current results. Regression coverage now includes saved-booking retries after token expiry/pricing changes, MFA/recovery, and frontend autocomplete behavior. The revised calculator appearance and cross-page booking flow still need browser verification. A live Geoapify request requires a valid API key and is not verified by mocked tests. The public build excludes server code, database files and secrets.
