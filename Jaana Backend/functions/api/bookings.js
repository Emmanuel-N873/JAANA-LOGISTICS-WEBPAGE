import { endpoint, body, text, lagosToday, hash, rateLimit, HttpError, json } from '../../server/common.js';
const services = ['Document Delivery', 'E-commerce Delivery', 'Food Delivery', 'Bulk & Business Delivery', 'Custom Logistics Solutions'];
const sizes = ['Envelope or document', 'Small parcel (handheld)', 'Medium parcel (box or bag)', 'Large or bulk shipment'];
export async function onRequest(context) {
  return endpoint(context, 'POST', async () => {
    await rateLimit(context, 'booking', 10, 600);
    const key = context.request.headers.get('Idempotency-Key') || '';
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(key)) throw new HttpError(400, 'A valid request key is required.');
    const data = await body(context.request);
    const order = {};
    for (const field of ['name', 'phone', 'service', 'date', 'recipient', 'recipientPhone', 'size', 'pickup', 'destination', 'package']) {
      order[field] = text(data, field, ['pickup', 'destination', 'package'].includes(field) ? 500 : field.includes('Phone') || field === 'phone' ? 30 : 100);
    }
    if (!services.includes(order.service) || !sizes.includes(order.size)) throw new HttpError(400, 'Choose a valid service and package size.');
    for (const phone of [order.phone, order.recipientPhone]) if (!/^\+?[0-9][0-9\s]{6,28}$/.test(phone)) throw new HttpError(400, 'Please provide valid phone numbers.');
    const date = new Date(`${order.date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(order.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== order.date || order.date < lagosToday() || date.getUTCDay() === 0) {
      throw new HttpError(400, 'Choose today or a future date, Monday to Saturday.');
    }
    const digest = await hash(JSON.stringify(order));
    const bytes = [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    const reference = `JAANA-${lagosToday().replaceAll('-', '')}-${bytes.match(/.{6}/g).join('-')}`;
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(`INSERT INTO bookings(reference,idempotency_key,payload_hash,customer_name,customer_phone,service,delivery_date,recipient_name,recipient_phone,package_size,pickup_address,delivery_address,package_details,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`).bind(reference, key, digest, order.name, order.phone, order.service, order.date, order.recipient, order.recipientPhone, order.size, order.pickup, order.destination, order.package, now, now),
      context.env.DB.prepare(`INSERT INTO booking_events(id,reference,status,created_at) SELECT reference||':created',reference,'requested',created_at FROM bookings WHERE idempotency_key=? ON CONFLICT(id) DO NOTHING`).bind(key)
    ]);
    const saved = await context.env.DB.prepare('SELECT reference,payload_hash,status,created_at FROM bookings WHERE idempotency_key=?').bind(key).first();
    if (saved.payload_hash !== digest) throw new HttpError(409, 'This request key was already used for different booking details.');
    return json({ reference: saved.reference, status: saved.status, createdAt: saved.created_at }, saved.reference === reference ? 201 : 200);
  });
}
