# Individual staff accounts and activity records

All account code, database tables, dashboard/ assets and setup tools live in `Jaana Backend`. Staff interface source is in `dashboard/`, API routes in `functions/api/`, shared server code in `server/`, and operational guides in `docs/`. Existing bookings remain unchanged. The shared `ADMIN_API_TOKEN` is no longer accepted for dashboard access.

## First administrator: local development

From the repository root:

```powershell
Set-Location "Jaana Backend"
npm.cmd run db:local
npm.cmd run staff:bootstrap
```

The setup command asks for the administrator's real name, email and a password of at least 14 characters. Password entry is hidden. Use a unique password, preferably a long passphrase. It creates the ignored `.staff-bootstrap.sql` file containing a salted password hash, never a plain-text password.

Apply it to your local database:

```powershell
npx.cmd wrangler d1 execute DB --local --file .staff-bootstrap.sql
Remove-Item -LiteralPath .staff-bootstrap.sql
npm.cmd run dev
```

Open `/admin.html` and sign in with that email and password. The administrator's name, role and initials appear in the header. The setup SQL creates an administrator only if there are no existing staff accounts. It never replaces an existing account. No default or publicly known account is created automatically.

## Activate on Cloudflare

Back up the production database before applying migrations. Run these commands from `Jaana Backend` against the configured production D1 binding:

```powershell
npx.cmd wrangler d1 migrations apply DB --remote
npm.cmd run staff:bootstrap
npx.cmd wrangler d1 execute DB --remote --file .staff-bootstrap.sql
Remove-Item -LiteralPath .staff-bootstrap.sql
```

The initial migration uses CREATE IF NOT EXISTS, so an existing booking database initially created manually is supported. Migration 0002 adds account, session and audit tables without rewriting bookings. Use a separate password for production. These commands intentionally target production only when you use `--remote`. Deploy the updated application after its tables and first account are ready. Neither production deployment nor production migrations are performed automatically by the code changes.

The old shared token in `.dev.vars` or Cloudflare secrets is unused; remove it from production configuration after the upgrade. Never publish `.dev.vars`, database exports or the bootstrap SQL file. If the bootstrap SQL file already exists, apply or securely remove that intended file before generating another.

## Daily account management

Administrators see **Staff accounts** and **Activity log** in the sidebar. Create a staff account with their name, email, role and a temporary password. Share credentials privately. At first sign-in staff must replace the temporary password before accessing orders.

- **Staff** can search and view bookings and update delivery statuses.
- **Administrator** can additionally create/manage accounts, reset passwords and view activity records.
- **My password** changes the current user's password and signs out every session for that account.
- **Reset password** assigns a new temporary password, revokes sessions and requires another password change.
- Uncheck **Account active** and save to deactivate a departed staff member. This revokes their sessions and prevents further sign-in.
- Name/role changes also revoke sessions. Account edits use a version to reject stale changes.
- Administrators cannot disable or demote their own account; the last active administrator is protected.

There are no self-registration or email-based password recovery endpoints. Ask an administrator for a reset. If all administrators lose access, the company database owner must perform controlled account recovery directly in D1; rerunning first-account setup does not override established users.

## What is traceable

Booking notification reads and acknowledgements are also recorded against individual accounts. Acknowledgement is a separate action from viewing or reading a booking alert. See [NOTIFICATIONS.md](NOTIFICATIONS.md) for setup, unread counts, optional sound and polling behaviour.

Backend records include sign-ins, failed sign-in attempts, sign-outs, password changes, account creation/edits/resets, booking searches/list views, detailed order views, delivery status changes, denied privileged requests, and viewing the audit log. Failed login records identify the attempted account, not a verified person. For signed-in actions, staff identity comes from the server session, never from client-submitted names.

Status changes record the previous and new status with the order reference and version in the same D1 transaction as the booking change. Their staff name/role also appear in the order's status history. Old events from before this upgrade have no individual staff attribution; new code cannot identify who performed historic shared-token actions.

Audit events retain the staff ID and name/role as they were at the time of the action. Search by staff, action or reference; times display in WAT. Audit details exclude passwords, password hashes and session tokens. There is no dashboard/API edit or delete operation for audit records. SQL triggers reject updates and deletes. A database owner with direct D1 access can still change schema or remove triggers; this is not externally sealed, tamper-proof storage. Browser clicks that do not contact the backend, screen views, and actions on other systems are not independently verified by this audit trail.

## Session and password design

Opaque 256-bit session tokens are placed in HttpOnly, SameSite=Strict cookies; Secure is required on HTTPS. Cookies contain no staff details; D1 stores only SHA-256 token hashes. Sessions expire after eight hours. Plain HTTP is permitted only on localhost for development. No credentials are stored in browser localStorage or sessionStorage. The UI clears customer/account data on sign-out and ignores stale responses from previous login sessions.

Passwords use unique random salts and PBKDF2-HMAC-SHA256 with 100,000 iterations (the Workers Web Crypto per-call limit). The minimum password length is 14 characters. Login attempts are limited per IP and account to 10 per 15-minute window. Password-change attempts are limited to 5 per 15 minutes. This implementation does not include MFA. For stronger identity protection or larger deployments, evaluate an identity provider rather than extending custom password authentication indefinitely.

Official runtime reference: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/

## API overview

| Method | Endpoint | Access |
| --- | --- | --- |
| POST | /api/staff?action=login | Email and password; sets session cookie |
| GET | /api/staff | Current signed-in identity |
| POST | /api/staff?action=logout | Current session; revokes it |
| POST | /api/staff?action=password | Current and new password; revokes all account sessions |
| GET/POST | /api/admin/staff | Administrator-only listing and create/update/reset actions |
| GET | /api/admin/activity | Administrator-only audit search; q, action, staff, page |
| GET | /api/admin/bookings | Signed-in staff, password change completed |
| GET | /api/admin/order | Signed-in staff, password change completed |
| PATCH | /api/admin/status | Signed-in staff, password change completed |
