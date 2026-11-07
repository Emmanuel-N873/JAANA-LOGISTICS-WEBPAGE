import {
  endpoint,
  requireAuthenticatedStaff,
  rateLimit,
  body,
  REFERENCE,
  HttpError,
  json,
} from '../../../server/common.js';
import { audit } from '../../../server/staff-auth.js';

const ACTIONS = new Set(['ticket.print_requested', 'ticket.pdf_export_requested']);

// These events record that a staff member started an action. They never claim
// that a printer or browser finished the action successfully.
export async function onRequest(context) {
  return endpoint(context, 'POST', async () => {
    await rateLimit(context, 'staff-ticket-event', 60, 60);
    await requireAuthenticatedStaff(context);
    const data = await body(context.request);
    const reference = typeof data.reference === 'string' ? data.reference.trim().toUpperCase() : '';
    const action = typeof data.action === 'string' ? data.action.trim() : '';

    if (!REFERENCE.test(reference) || !ACTIONS.has(action))
      throw new HttpError(400, 'Invalid ticket action or booking reference.');

    const order = await context.env.DB.prepare('SELECT status FROM bookings WHERE reference=?')
      .bind(reference)
      .first();
    if (!order) throw new HttpError(404, 'Booking not found.');
    if (order.status !== 'delivered')
      throw new HttpError(409, 'Ticket actions are available only for delivered bookings.');

    await audit(context, context.staff, action, reference, { source: 'ticket-page' });
    return json({ ok: true, action });
  });
}
