# Reading and maintaining JAANA's frontend

This guide is for someone who knows basic HTML, CSS, and JavaScript. Start here before changing customer or staff behavior. This pass keeps the existing design, prices, API contracts, and security checks.

## Start here if you are new to the project

Read this guide in order, then follow the smallest path that matches your change:

| If you want to change...                        | Start with...                        | Then check...                                                      |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| Homepage text or layout                         | `index.html`                         | `assets/css/styles.css`                                            |
| Calculator fields or estimate display           | `calculator.html`                    | `assets/js/calculator.js` and the estimate tests                   |
| Booking submission or retry behavior            | `assets/js/booking.js`               | `assets/js/booking-transfer.js` and booking tests                  |
| Shared colors, spacing, buttons or focus styles | `assets/css/design-system.css`       | All three customer pages at phone and desktop widths               |
| Staff dashboard behavior                        | `Jaana Backend/dashboard/admin.html` | `Jaana Backend/dashboard/js/admin.js` and the related feature file |

The frontend is deliberately built with HTML, CSS and JavaScript instead of a component framework. That keeps the browser behavior visible to a beginner, but it means the script order and shared browser contracts in this guide are part of the design. Do not reorder scripts or rename storage keys casually.

## 1. Where the frontend lives

| File or folder                          | Purpose                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `index.html`                            | Homepage, services, booking dialog, tracking dialog, contact information            |
| `calculator.html`                       | Delivery calculator page                                                            |
| `assets/css/design-system.css`          | Shared design tokens and base controls                                              |
| `assets/css/styles.css`                 | Homepage sections and shared site layout                                            |
| `assets/css/calculator.css`             | Calculator, address suggestions, booking shipment fields, shared footer adjustments |
| `assets/js/`                            | Customer-facing behavior, including address search and current-location selection   |
| `Jaana Backend/dashboard/admin.html`    | Staff interface source; published as `/admin.html`                                  |
| `Jaana Backend/dashboard/css/admin.css` | Staff interface styling                                                             |
| `Jaana Backend/dashboard/js/`           | Staff interface behavior                                                            |
| `Jaana Backend/dist/`                   | Generated output. Never edit it by hand.                                            |

The staff interface lives inside the backend folder for packaging, but its HTML, CSS, and JavaScript are frontend source. The build script maps these private source paths to public `/assets/...` URLs.

## 2. A useful reading order

1. Open `calculator.html` and locate `rate-form`, `rate-feedback`, `continue-booking`, and the two address location buttons.
2. Read `assets/js/delivery-summary.js`: two small functions format amounts and saved estimates. They do not calculate prices.
3. Read `assets/js/calculator.js`: search or reverse-geocode addresses, request an estimate, display it, and continue to booking.
4. Read `assets/js/booking-transfer.js`: restore drafts, lock transferred fields, preserve request identity, and offer a return to the calculator.
5. Read `assets/js/booking.js`: validate and submit booking fields, display the saved result, check delivery status, and construct WhatsApp messages.
6. Read `assets/js/script.js`: shared homepage controls for navigation and dialogs.
7. Read `assets/js/service-carousel.js`: slideshow behavior only.

For staff pages, start with `dashboard/admin.html`, then `dashboard/js/admin.js`, then the feature file you need.

The large HTML and CSS files are organized by page sections rather than by framework components. When editing one, use the section heading and nearby selectors as your boundary. Avoid a broad selector or a new global style when a page-specific class will do.

## 3. What happens when a customer books

```text
Customer selects Geoapify address suggestions
  -> calculator.js receives signed location references
  -> POST /api/estimate verifies selections and calculates price on the server
  -> calculator displays the returned breakdown
  -> Continue to Booking saves a temporary shipment draft
  -> index.html#booking opens the original booking dialog
  -> booking-transfer.js restores and locks shipment fields
  -> customer fills sender, recipient, service, date and package details
  -> booking.js submits POST /api/bookings with a stable request key
  -> server saves or returns the existing request and its saved price
  -> UI shows the reference and updates the price/WhatsApp message
  -> temporary drafts are cleared after success
```

A successful request is still subject to JAANA's availability and pricing confirmation. Do not turn it into a payment or reservation promise through a wording change.

## 4. Script loading and small public contracts

Scripts use `defer`, so they run after the HTML is parsed and in their document order. Keep this order on the homepage:

1. `delivery-summary.js`
2. `booking-transfer.js`
3. `script.js`
4. `booking.js`
5. `service-carousel.js`

The calculator loads `delivery-summary.js` before `calculator.js`. Scripts wrap their internal variables in a function so they do not accidentally overwrite each other. Only the following named contracts are shared:

| Contract                                        | Created by              | Used by                                                                  |
| ----------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `window.JaanaDelivery.formatMoney(amount)`      | `delivery-summary.js`   | Calculator presentation                                                  |
| `window.JaanaDelivery.formatEstimate(shipment)` | `delivery-summary.js`   | Calculator and booking summary                                           |
| `window.JaanaBooking.prepareAttempt(fields)`    | `booking-transfer.js`   | Booking submission; returns a promise containing `fingerprint` and `key` |
| `window.JaanaBooking.applyShipment(shipment)`   | `booking-transfer.js`   | Booking submission; updates saved price fields and returns `{ changed }` |
| `window.jaanaBookingLocationTokens()`           | `booking-transfer.js`   | Booking submission; returns copies of the selected-location tokens       |
| `window.JaanaStaff.api(url, options)`           | `dashboard/js/admin.js` | Staff feature scripts; handles authenticated requests and session errors |
| `window.JaanaStaff.logout()`                    | `dashboard/js/admin.js` | Staff account and authenticator screens                                  |
| `window.JaanaStaff.openOrder(reference)`        | `dashboard/js/admin.js` | Notifications and acknowledgements                                       |

Adding another global helper should solve a real shared need. Prefer a clearly named function within the feature that owns the behavior.

## 5. Browser storage and duplicate protection

`sessionStorage` lasts for the browser tab/session. These keys are deliberately stable across pages:

| Key                              | Contains                                                              | Cleared when                                        |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `jaana.shipmentDraft.v1`         | Shipment fields, estimate, and short-lived signed location references | Booking succeeds or customer starts another booking |
| `jaana.bookingDetailsDraft.v1`   | An explicit allowlist of sender/recipient and booking fields          | Booking succeeds or customer starts another booking |
| `jaana.pendingBookingAttempt.v1` | A fingerprint and idempotency key                                     | Booking succeeds or customer starts another booking |

A fingerprint identifies the meaningful booking fields. An idempotency key lets the server recognize a retry rather than create another order. Price text and refreshed location proof tokens do not create a new request identity. The server independently validates all data and enforces duplicate protection.

Only the latest saved booking reference is kept in localStorage. Never put passwords, staff sessions, MFA setup secrets, recovery codes, payment data, or provider API keys in browser storage. A signed location token is a short-lived proof of a selected address, not a staff login token. If sessionStorage is blocked, retries retain their key only within the current page.

## 6. Staff features and events

| File                     | Responsibility                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| `admin.js`               | Sign-in state, shared API client, order search/list/details, status updates |
| `admin-accounts.js`      | Password changes, account management, audit history                         |
| `admin-notifications.js` | Notification polling, unread counts, sound, acknowledgements                |
| `admin-mfa.js`           | Authenticator enrollment and one-time display of recovery codes             |
| `admin-pricing.js`       | Administrator pricing form                                                  |

The dashboard's `currentStaffId` is an identity marker used to ignore outdated responses. The actual login session is an HttpOnly cookie managed by the browser and server; frontend JavaScript cannot read it.

These browser events connect existing features:

| Event                 | Producer     | Payload and effect                                                                        |
| --------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `staff-session`       | `admin.js`   | Staff user or `null`; feature scripts open/clear their controls and stop work on sign-out |
| `staff-order`         | `admin.js`   | `{ order, acknowledgement }`; notifications update acknowledgement controls               |
| `jaana-booking-saved` | `booking.js` | No payload; booking-transfer clears pending drafts                                        |

Request-version counters reject late responses after a different account signs in or another order opens. Do not remove them as "unused complexity": they prevent stale or private information from appearing in a newer session. Hiding a button is a usability measure; the API must still authorize every protected action.

## 7. How to change the presentation safely

- Keep existing navy headings, blue actions, yellow booking emphasis, and visible keyboard focus.
- Follow `design-system.css` for established token values and controls.
- Preserve selector and stylesheet order during a formatting pass. Existing later rules can override earlier ones.
- Prefer clear names, one logical action per statement, and comments explaining a business/security reason.
- Use `textContent` for customer-supplied text. Do not insert untrusted strings into HTML.
- Keep price calculation, permissions, signed-token verification, and final validation on the server.
- Changing labels or display text should not change API field names or storage keys accidentally.

### Safe change recipes

**Changing a customer-facing label:** edit the relevant HTML text, then check the associated feedback messages in the JavaScript file. Labels are user-facing; form `name` values and element IDs are part of the browser/API contract.

**Changing a form field:** update the HTML, the client-side validation, the transfer allowlist if the field crosses pages, the server validation, and the relevant tests. A field that only appears in the browser is not automatically saved by the backend.

**Changing a price message:** update the shared presentation in `delivery-summary.js` first. Do not calculate or trust a final price in the browser. The server response is authoritative.

**Changing a dialog:** preserve its `aria-labelledby` relationship, close button, Escape behavior, focus behavior, loading state, and error message. Test opening it from both the main navigation and any page-specific button.

**Changing a dashboard feature:** keep the feature's API calls in its existing dashboard file, handle sign-out and stale responses, and confirm the backend still authorizes the action. Hiding a control is not permission enforcement.

## 8. Formatting and checks

Run inside `Jaana Backend`:

```powershell
npm.cmd run format:frontend
npm.cmd run check:frontend
npm.cmd test
npm.cmd run build
```

Prettier is a pinned development-only formatter. It does not run in the browser. Its settings are in the repository-root `.prettierrc.json`; the formatting script explicitly targets frontend files and frontend tests.

The frontend tests execute real feature scripts with lightweight browser stand-ins. They cover booking retries, saved-price messages, autocomplete behavior, shared formatting, script order, slideshow controls, and reduced motion. They do not replace checking actual layouts in a browser.

Before publishing a UI change, verify the homepage, calculator, booking dialog and staff screens at phone and desktop widths. Check keyboard navigation, Escape/close behavior, loading/error messages, selected addresses, prices, and sign-out. Never test payments or production customer records just to check a layout.

## 9. Manual browser checklist

Use a local Pages runtime so the `/api/...` calls exist. Opening the HTML file directly only checks static markup and will make the API appear unavailable.

### Customer pages

- [ ] The first screen explains JAANA's service and presents the main booking action.
- [ ] The navigation opens and closes with a keyboard and on a narrow screen.
- [ ] Every dialog opens, closes with its close button and Escape, and returns focus sensibly.
- [ ] Address suggestions can be selected with pointer, Arrow keys and Enter.
- [ ] An estimate shows loading, success, no-result and error states.
- [ ] A changed address or weight cannot reuse an old quote or location token.
- [ ] Continue to Booking restores the shipment details and keeps them visibly read-only where required.
- [ ] A timed-out booking can be retried without creating a duplicate.
- [ ] The booking reference, status lookup and WhatsApp action work after success.
- [ ] The carousel can be paused and does not animate when reduced motion is enabled.

### Staff dashboard

- [ ] The sign-in form works at phone and desktop widths.
- [ ] Temporary-password and MFA setup messages are understandable.
- [ ] Staff can search, filter, open an order and update status where permitted.
- [ ] Administrators see administrator tools; ordinary staff do not.
- [ ] Sign-out clears private dashboard content and stops polling or notifications.
- [ ] Dialogs, tables, filters and notifications remain usable at narrow widths.
