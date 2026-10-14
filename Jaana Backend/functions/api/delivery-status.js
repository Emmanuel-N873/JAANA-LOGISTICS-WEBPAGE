import { endpoint, body, text, rateLimit, REFERENCE, STATUSES, HttpError, json } from '../../server/common.js';
export async function onRequest(context) {
  return endpoint(context, 'POST', async () => {
    await rateLimit(context, 'status', 30, 60);
    const reference = text(await body(context.request), 'reference').toUpperCase();
    if (!REFERENCE.test(reference)) throw new HttpError(400, 'Enter a valid JAANA booking reference.');
    // Public lookup deliberately excludes names, addresses, phones and package details.
    const order = await context.env.DB.prepare('SELECT reference,status,updated_at FROM bookings WHERE reference=?').bind(reference).first();
    if (!order) throw new HttpError(404, 'No saved booking was found. If you booked through WhatsApp before this service launched, contact our team.');
    return json({ reference: order.reference, status: order.status, label: STATUSES[order.status], updatedAt: order.updated_at });
  });
}
