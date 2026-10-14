# JAANA Logistics

Responsive company website with a Cloudflare Pages Functions backend and D1 order storage.

## Project layout

```text
JAANA DELIVERY WEB PAGE/
  index.html                   # Public landing page
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

## Run locally

Use Node.js 22.13 or newer (Node 24 recommended). In a terminal at the repository root:

```powershell
Set-Location "Jaana Backend"
npm.cmd install
npm.cmd run db:local
npm.cmd run dev
```

Create the first local administrator using [the staff account guide](<Jaana Backend/docs/STAFF-ACCOUNTS.md>). Sign-in uses individual email/password accounts; the old shared token is no longer accepted. Never commit local secrets or bootstrap SQL.

Open the address printed by Wrangler, normally http://127.0.0.1:8788. Staff orders are at `/admin.html`. Opening index.html directly or using Live Server does not run the API.

## Deploy

Follow [the backend setup guide](<Jaana Backend/docs/BACKEND-SETUP.md>). Replace the all-zero D1 database ID before production and create a production administrator account. Pages settings:

| Setting | Value |
| --- | --- |
| Root directory | Jaana Backend |
| Build command | npm run build |
| Build output directory | dist |

The backend build includes the landing page and assets/ from the parent folder. It maps dashboard/ source files to public staff asset URLs and copies configuration from public/. Live URLs remain `/api/bookings`, `/api/delivery-status`, `/api/admin/...` and `/admin.html`.

## Booking and staff workflow

Validated requests are saved in D1 with server-generated references and duplicate-request protection. Customers can copy the reference, check staff-maintained delivery status, or follow up on WhatsApp. Only the latest reference is stored in the browser; customer details are saved in D1. JAANA confirms availability, pricing and bookings. No automatic reservations, payments or GPS tracking are performed. Older WhatsApp-only references are not in the database. Quotations continue through WhatsApp without becoming saved orders.

The website footer links to **Staff Dashboard**, which requires an individual staff account and a secure session cookie. The responsive dashboard provides live database totals, search by reference/customer/address, status/area/delivery-date filters, and pagination. Open an order to view full details, copy its reference, review its status history and save status updates with conflict checks and individual staff attribution. Administrators manage accounts and inspect a searchable activity log. Signing out clears customer details and prevents old requests from changing a newer session. Use HTTPS, keep staff access private and deactivate accounts when staff leave.

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

The backend tests cover SQL persistence, retries, references, validation, rate limits, staff authentication, public-data privacy, audit events and stale-update conflicts. The real Cloudflare local runtime and browser booking/staff/status workflow have also been tested. The public build excludes server code, database files and secrets.
