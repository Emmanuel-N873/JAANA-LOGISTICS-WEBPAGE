# Staff booking notifications (Phase 1)

## Activate

From `Jaana Backend`, apply the migrations and rebuild:

```powershell
npm.cmd run db:local
npm.cmd run dev
```

For production, apply `npx.cmd wrangler d1 migrations apply DB --remote` to the intended production database, then deploy the updated application. Migration `0003_notifications.sql` adds notification events, individual read receipts, shared booking acknowledgements and a booking-insert trigger. It backfills existing bookings into notification history without changing their delivery statuses. Existing staff see these as unread on first use; historical records do not trigger the initial pop-up or sound.

## Using the dashboard

- The bell beside the staff profile shows the signed-in person's unread count. `99+` means more than 99 unread alerts.
- Click the bell for paginated notification history, then **View booking** or **Mark read**. Opening the bell alone does not mark every item as read.
- **Acknowledge booking** explicitly records responsibility against the current staff account. Viewing/reading an alert does not acknowledge it. Acknowledgement also remains separate from delivery status.
- The first acknowledgement wins. Other staff see the recorded name and time and cannot overwrite it. Repeating your own acknowledgement is safe. Cancelled/delivered bookings cannot receive a new acknowledgement.
- Acknowledgement is available in notification history and order details. Times display in WAT.
- **Enable sound** opts in for the current signed-in page session; **Mute sound** disables it. Browser audio restrictions still apply. Sound resets on sign-out and is not stored in browser storage.
- New arrivals produce a dismissible in-dashboard pop-up. Dismissing it does not mark notifications as read or acknowledge the orders.

## Polling and reliability

The dashboard checks every 15 seconds while visible. Checks pause in hidden tabs and stop on sign-out; returning to the tab or reconnecting refreshes notifications. Network errors back off up to two minutes. Staff must remain signed in. Phase 1 does not provide phone push, email or WhatsApp alerts, and a closed dashboard does not receive alerts.

The first successful check establishes the pop-up baseline; the bell/history still include older unread records. Subsequent checks use monotonic event IDs, fetching up to 50 new events per batch without skipping a backlog. Notification history shows 30 items per page. Staff cannot access notifications until they have completed any required temporary-password change.

The database creates one durable notification event as part of each successful booking insert. The unique booking reference prevents duplicates when customers retry. There is no external notification call in booking submission: dashboard, sound or network failures do not undo a saved booking. A genuine database-write failure still prevents a booking from being accepted and must be retried. Apply the migration before deploying code that queries the notification tables.

Read receipts are private to each staff account. Acknowledgements are shared across authorised staff. Both admin and staff roles can receive alerts because both currently have access to all bookings. Phase 1 does not introduce department-specific recipients or delivery assignment/reassignment.

Poll requests use a separate rate-limit bucket and do not create audit entries on every check. First reads and successful acknowledgements are audited, with staff identity taken from the authenticated server session. Notification responses omit phone numbers, package descriptions and addresses; open the authenticated order-details view for full booking information.

## Source files

| Location | Purpose |
| --- | --- |
| `migrations/0003_notifications.sql` | Event/read/acknowledgement storage, trigger and history backfill |
| `functions/api/admin/notifications.js` | Signed-in history, polling, read receipts and acknowledgement |
| `dashboard/js/admin-notifications.js` | Bell, polling, pop-ups, sound and acknowledgement controls |
| `dashboard/admin.html` / `dashboard/css/admin.css` | Accessible controls and responsive styling |
| `tests/backend.test.mjs` | Retry, privacy, identity, acknowledgement conflict, cursor and migration checks |

`GET /api/admin/notifications` accepts `page` and optional `after` event cursor. `POST` accepts `{ action: "read" | "acknowledge", reference }`. Both require a valid staff session. GET polling allows 240 requests per IP per minute; actions allow 60. Requests return no-store responses.
