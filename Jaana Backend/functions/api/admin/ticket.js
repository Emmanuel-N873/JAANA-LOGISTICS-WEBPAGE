import {
  endpoint,
  requireAuthenticatedStaff,
  rateLimit,
  REFERENCE,
  HttpError,
  json,
} from '../../../server/common.js';
import { audit } from '../../../server/staff-auth.js';

// A ticket is only available after staff has marked the booking as delivered.
// This keeps the ticket from being mistaken for proof of delivery too early.
export async function onRequest(context) {
  return endpoint(context, 'GET', async () => {
    await rateLimit(context, 'staff-ticket', 30, 60);
    await requireAuthenticatedStaff(context);

    const reference = (new URL(context.request.url).searchParams.get('reference') || '')
      .trim()
      .toUpperCase();

    if (!REFERENCE.test(reference)) throw new HttpError(400, 'Enter a valid booking reference.');

    const order = await context.env.DB.prepare(
      `SELECT reference,customer_name,customer_phone,service,delivery_date,recipient_name,recipient_phone,package_size,pickup_address,delivery_address,package_details,shipment_json,status,created_at,updated_at,
        (SELECT a.staff_name FROM booking_events e LEFT JOIN staff_audit a ON a.id=e.id WHERE e.reference=b.reference AND e.status='delivered' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS delivered_by
       FROM bookings b WHERE reference=?`
    )
      .bind(reference)
      .first();

    if (!order) throw new HttpError(404, 'Booking not found.');
    if (order.status !== 'delivered')
      throw new HttpError(
        409,
        'The delivery ticket is available after the order is marked delivered.'
      );

    let shipment = null;
    try {
      const parsed = order.shipment_json ? JSON.parse(order.shipment_json) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) shipment = parsed;
    } catch {
      // Older bookings may not have calculator details. The ticket still shows the saved form.
    }

    await audit(context, context.staff, 'ticket.viewed', reference, { source: 'ticket-page' });

    return json({
      ticket: {
        reference: order.reference,
        status: order.status,
        sender: { name: order.customer_name, phone: order.customer_phone },
        recipient: { name: order.recipient_name, phone: order.recipient_phone },
        service: order.service,
        deliveryDate: order.delivery_date,
        pickupAddress: order.pickup_address,
        deliveryAddress: order.delivery_address,
        packageSize: order.package_size,
        packageDetails: order.package_details,
        shipment,
        createdAt: order.created_at,
        completedAt: order.updated_at,
        deliveredBy: order.delivered_by || 'JAANA Delivery Service Ltd team',
      },
    });
  });
}
