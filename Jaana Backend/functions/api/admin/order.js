import { endpoint, requireAdmin, rateLimit, STATUSES, REFERENCE, HttpError, json } from '../../../server/common.js';
import { audit } from '../../../server/staff-auth.js';
export async function onRequest(context) {
  return endpoint(context, 'GET', async () => {
    await rateLimit(context, 'staff', 60, 60);
    await requireAdmin(context);
    const reference = (new URL(context.request.url).searchParams.get('reference') || '').trim().toUpperCase();
    if (!REFERENCE.test(reference)) throw new HttpError(400, 'Enter a valid booking reference.');
    const order = await context.env.DB.prepare(`SELECT reference,customer_name,customer_phone,service,delivery_date,recipient_name,recipient_phone,package_size,pickup_address,delivery_address,package_details,status,created_at,updated_at,version FROM bookings WHERE reference=?`).bind(reference).first();
    if (!order) throw new HttpError(404, 'Booking not found. Refresh the order list.');
    const events = await context.env.DB.prepare('SELECT e.status,e.created_at,a.staff_id,a.staff_name,a.staff_role FROM booking_events e LEFT JOIN staff_audit a ON a.id=e.id WHERE e.reference=? ORDER BY e.created_at,e.id').bind(reference).all();
    await audit(context, context.staff, 'booking.view', reference);
    return json({ order, events: events.results, statuses: STATUSES });
  });
}
