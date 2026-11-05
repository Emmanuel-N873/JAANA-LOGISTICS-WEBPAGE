# Reading and maintaining the JAANA backend

This guide explains the backend in the order a junior developer is most likely to understand it. The application is a Cloudflare Pages Functions API connected to a Cloudflare D1 SQLite database.

## Start with the request lifecycle

Most API requests follow this path:

```text
HTTP request
  -> route file in functions/api/
  -> endpoint() checks method, origin and database configuration
  -> rateLimit() limits repeated or expensive requests
  -> requireStaff() checks the staff session when needed
  -> route validates the request data
  -> prepared SQL statements read or change D1
  -> audit record is written for staff actions
  -> JSON response is returned
```

The order is important. Authentication and authorization happen on the server before protected data is returned or changed. Browser controls are only a convenience; they are not permission checks.

## Where to look first

| Task | Start here | Why |
| --- | --- | --- |
| Add or change a public booking rule | `functions/api/bookings.js` | Validates and saves customer booking requests |
| Change pricing or estimates | `functions/api/pricing.js` and `functions/api/estimate.js` | Keeps final pricing on the server |
| Change address search or routing | `functions/api/locations.js` and `functions/api/estimate.js` | Talks to Geoapify and signs selected locations |
| Change staff sign-in | `functions/api/staff.js` and `server/staff-auth.js` | Handles passwords, sessions and account rules |
| Change MFA | `functions/api/mfa.js` and `server/mfa.js` | Handles authenticator secrets and recovery codes |
| Change staff order access | `functions/api/admin/bookings.js`, `order.js` and `status.js` | Reads orders and updates delivery status |
| Change administrator-only features | `functions/api/admin/staff.js`, `activity.js` and `pricing.js` | These routes use explicit administrator authorization |
| Change shared request protection | `server/common.js` | Shared method, origin, body, errors and rate limits |
| Change the database | `migrations/` | Add a new numbered migration; never edit an applied migration |

The `/api/admin/` path means “staff dashboard API.” It does not mean every route is administrator-only. Ordinary staff are allowed to view bookings and update statuses. Administrator-only routes call `requireStaff(context, { administratorOnly: true })`.

## Authentication vocabulary

- **Authentication** means proving which staff member is signed in.
- **Authorization** means deciding whether that staff member may perform an action.
- **Session** means the temporary server-side login record connected to an HttpOnly cookie.
- **MFA** means a second factor, such as a six-digit authenticator code.

Use the named options when calling `requireStaff`:

```js
await requireStaff(context);
await requireStaff(context, { administratorOnly: true });
await requireStaff(context, { allowPasswordChange: true });
```

Do not create a new permission check in frontend JavaScript. Add it to the route and data operation on the server.

## Database rules

- Use prepared statements with `.bind(...)`; never build SQL by concatenating user input.
- Add schema changes as the next numbered file in `migrations/`.
- Add indexes only when they support a real query used by the application.
- Keep customer data out of public responses unless the endpoint explicitly requires it.
- Use a transaction or D1 batch when related writes must succeed together.
- Use a version check when two staff members could edit the same record.

The main tables are:

| Table | Purpose |
| --- | --- |
| `bookings` | Customer delivery requests and current status |
| `booking_events` | Status history for each booking |
| `staff_users` | Staff identity, role, password and MFA state |
| `staff_sessions` | Hashed active session tokens |
| `staff_audit` | Append-only staff activity records |
| `staff_recovery_codes` | Hashed one-time MFA recovery codes |
| `api_rate_limits` | Short-lived request counters |

## Error handling

Throw `HttpError` when the customer or staff member should receive a known validation or permission message. The shared `endpoint()` wrapper converts it to JSON.

Unexpected errors receive a generic 503 response. Do not include passwords, tokens, MFA secrets, customer addresses or provider keys in errors or logs.

## How to make a backend change safely

1. Find the route that owns the behavior.
2. Read its tests before changing the code.
3. Identify the access rule and data fields involved.
4. Validate input at the route boundary.
5. Keep important business rules on the server.
6. Add or update a test for success, invalid input and unauthorized access.
7. Run `npm.cmd test` and `npm.cmd run build`.
8. If a migration changed, test both a new local database and an existing database with the migration applied.

## Backend checks

Run these commands inside `Jaana Backend`:

```powershell
npm.cmd test
npm.cmd run test:performance
npm.cmd run build
```

Tests use local or in-memory fixtures and do not prove production Cloudflare configuration. Before deployment, separately verify secrets, D1 binding, migrations, HTTPS, provider quotas and staging behavior. See [RELIABILITY-SECURITY.md](RELIABILITY-SECURITY.md) for the deployment and recovery checklist.
