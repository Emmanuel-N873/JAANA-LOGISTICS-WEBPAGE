# JAANA Logistics

Responsive company website with a Cloudflare Pages Functions backend and D1 order storage.

## Project layout

```text
JAANA DELIVERY WEB PAGE/
  index.html
  script.js
  styles.css
  design-system.css
  favicon.ico
  image/
  .gitignore
  README.md
  Jaana Backend/
    functions/
    server/
    migrations/
    tests/
    scripts/
    admin.html
    admin.css
    admin.js
    package.json
    package-lock.json
    wrangler.jsonc
    .dev.vars.example
    .dev.vars           (ignored local staff secret)
    .wrangler/          (ignored local runtime/database state)
    node_modules/       (ignored dependencies)
    dist/               (ignored generated public output)
    _headers
    _routes.json
    BACKEND-SETUP.md
```

Customer-facing files and images remain in the project root. Backend code, staff interface, database configuration, development dependencies, tests and backend setup instructions are grouped in `Jaana Backend`.

## Run locally

Use Node.js 22.13 or newer (Node 24 recommended). In a terminal at the repository root:

```powershell
Set-Location "Jaana Backend"
npm.cmd install
npm.cmd run db:local
npm.cmd run dev
```

The existing local staff token is in the ignored `Jaana Backend/.dev.vars` file. For a fresh checkout, copy `.dev.vars.example` to `.dev.vars` inside the backend folder and set a private ADMIN_API_TOKEN of at least 32 characters. Do not overwrite an existing secret or commit it to Git.

Open the address printed by Wrangler, normally http://127.0.0.1:8788. Staff orders are at `/admin.html`. Opening index.html directly or using Live Server does not run the API.

## Deploy

Follow [the backend setup guide](<Jaana Backend/BACKEND-SETUP.md>). Replace the all-zero D1 database ID before production and set the staff secret in Cloudflare. Pages settings:

| Setting | Value |
| --- | --- |
| Root directory | Jaana Backend |
| Build command | npm run build |
| Build output directory | dist |

The backend build includes the frontend assets from the parent folder. Live URLs remain `/api/bookings`, `/api/delivery-status`, `/api/admin/...` and `/admin.html`.

## Booking and staff workflow

Validated requests are saved in D1 with server-generated references and duplicate-request protection. Customers can copy the reference, check staff-maintained delivery status, or follow up on WhatsApp. Only the latest reference is stored in the browser; customer details are saved in D1. JAANA confirms availability, pricing and bookings. No automatic reservations, payments or GPS tracking are performed. Older WhatsApp-only references are not in the database. Quotations continue through WhatsApp without becoming saved orders.

The staff page requires a private shared access token, kept only in page memory. It lists orders and supports status updates with conflict checks and an event history. Use HTTPS, keep staff access private and rotate the production token when access changes.

## Company and assets

The user confirmed company contacts, coverage and displayed statistics on 13 October 2026. Contact: 0907 257 3328, WhatsApp 0803 842 2591, jaanadelivery@gmail.com, No. 20 Oyin Onibokun Crescent, Isheri-Osun, Lagos 102214. Working hours: Monday-Saturday, 9:00am-5:00pm WAT. This records user confirmation rather than an independent audit.

The supplied Company Logo.jpeg provides the company logo. Favicon, hero and service generation prompts are retained under image/. Hero and service images are generated illustrations, not actual staff photographs. The coverage SVG is schematic. Original reference images are retained but excluded from the public build.

The slideshow advances every two seconds, supports manual/keyboard/touch controls, pauses for hover/focus and respects reduced motion. Social links use the supplied company URLs.

## Verification

Run these commands inside `Jaana Backend`:

```powershell
npm.cmd test
npm.cmd run build
```

The backend tests cover SQL persistence, retries, references, validation, rate limits, staff authentication, public-data privacy, audit events and stale-update conflicts. The real Cloudflare local runtime and browser booking/staff/status workflow have also been tested. The public build excludes server code, database files and secrets.
