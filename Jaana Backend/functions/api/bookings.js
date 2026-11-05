import { route } from './estimate.js';
import { pricing, estimate } from './pricing.js';
import {
  endpoint,
  body,
  text,
  lagosToday,
  hash,
  rateLimit,
  HttpError,
  json,
} from '../../server/common.js';
const services = [
  'Document Delivery',
  'E-commerce Delivery',
  'Food Delivery',
  'Bulk & Business Delivery',
  'Custom Logistics Solutions',
];
const bookingResult = (saved) => ({
  reference: saved.reference,
  status: saved.status,
  createdAt: saved.created_at,
  shipment: saved.shipment_json ? JSON.parse(saved.shipment_json) : null,
});
const sizes = [
  'Envelope or document',
  'Small parcel (handheld)',
  'Medium parcel (box or bag)',
  'Large or bulk shipment',
];
export async function onRequest(context) {
  return endpoint(context, 'POST', async () => {
    await rateLimit(context, 'booking', 10, 600);
    const key = context.request.headers.get('Idempotency-Key') || '';
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(key))
      throw new HttpError(400, 'A valid request key is required.');
    const data = await body(context.request);
    const order = {};
    for (const field of [
      'name',
      'phone',
      'service',
      'date',
      'recipient',
      'recipientPhone',
      'size',
      'pickup',
      'destination',
      'package',
    ]) {
      order[field] = text(
        data,
        field,
        ['pickup', 'destination', 'package'].includes(field)
          ? 500
          : field.includes('Phone') || field === 'phone'
            ? 30
            : 100
      );
    }
    if (!services.includes(order.service) || !sizes.includes(order.size))
      throw new HttpError(400, 'Choose a valid service and package size.');
    for (const phone of [order.phone, order.recipientPhone])
      if (!/^\+?[0-9][0-9\s]{6,28}$/.test(phone))
        throw new HttpError(400, 'Please provide valid phone numbers.');
    let shipment = null;
    if (data.weight || data.packages) {
      shipment = {};
      for (const field of ['packages', 'weight', 'length', 'width', 'height']) {
        if (!data[field]) continue;
        const value = Number(data[field]);
        if (
          !Number.isFinite(value) ||
          value <= 0 ||
          value > 10000 ||
          (field === 'packages' && !Number.isInteger(value))
        )
          throw new HttpError(400, 'Invalid shipment ' + field + '.');
        shipment[field] = value;
      }
      if (!shipment.packages || !shipment.weight)
        throw new HttpError(400, 'Enter package count and combined weight.');
    }
    // The request identity excludes provider results, prices and expiring proof tokens.
    const requestHash = await hash(JSON.stringify({ ...order, ...(shipment ? { shipment } : {}) }));
    const previous = await context.env.DB.prepare('SELECT * FROM bookings WHERE idempotency_key=?')
      .bind(key)
      .first();
    const matchesSaved = async (saved) => {
      if (saved.request_hash) return saved.request_hash === requestHash;
      // Requests made before migration 0005 still have a safe retry path.
      const oldOrder = {};
      const columns = {
        name: 'customer_name',
        phone: 'customer_phone',
        service: 'service',
        date: 'delivery_date',
        recipient: 'recipient_name',
        recipientPhone: 'recipient_phone',
        size: 'package_size',
        pickup: 'pickup_address',
        destination: 'delivery_address',
        package: 'package_details',
      };
      for (const [name, column] of Object.entries(columns)) oldOrder[name] = saved[column];
      let oldShipment = null;
      if (saved.shipment_json) {
        oldShipment = {};
        const parsed = JSON.parse(saved.shipment_json);
        for (const field of ['packages', 'weight', 'length', 'width', 'height'])
          if (parsed[field]) oldShipment[field] = parsed[field];
      }
      return (
        (await hash(
          JSON.stringify({ ...oldOrder, ...(oldShipment ? { shipment: oldShipment } : {}) })
        )) === requestHash
      );
    };
    if (previous) {
      if (!(await matchesSaved(previous)))
        throw new HttpError(
          409,
          'This request key was already used for different booking details.'
        );
      return json(bookingResult(previous));
    }
    const date = new Date(`${order.date}T12:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(order.date) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== order.date ||
      order.date < lagosToday() ||
      date.getUTCDay() === 0
    ) {
      throw new HttpError(400, 'Choose today or a future date, Monday to Saturday.');
    }
    if (shipment) {
      const hasPickupToken = typeof data.pickupToken === 'string' && data.pickupToken.length > 0;

      const hasDestinationToken =
        typeof data.destinationToken === 'string' && data.destinationToken.length > 0;

      const hasCalculatorEstimate =
        data.distanceKm !== undefined && data.distanceKm !== null && data.distanceKm !== '';

      if (hasCalculatorEstimate || hasPickupToken || hasDestinationToken) {
        if (!hasPickupToken || !hasDestinationToken) {
          throw new HttpError(
            400,
            'Your delivery estimate needs valid pickup and destination selections. Please return to the calculator and select both addresses again.'
          );
        }

        shipment.distanceKm = await route(
          context,
          order.pickup,
          order.destination,
          data.pickupToken,
          data.destinationToken
        );
        shipment.rates = await pricing(context);
        Object.assign(shipment, estimate(shipment.distanceKm, shipment.weight, shipment.rates));
      }
    }
    const digest = await hash(JSON.stringify({ ...order, ...(shipment ? { shipment } : {}) }));
    const bytes = [...crypto.getRandomValues(new Uint8Array(12))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const reference = `JAANA-${lagosToday().replaceAll('-', '')}-${bytes.match(/.{6}/g).join('-')}`;
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO bookings(reference,idempotency_key,payload_hash,customer_name,customer_phone,service,delivery_date,recipient_name,recipient_phone,package_size,pickup_address,delivery_address,package_details,created_at,updated_at,shipment_json,request_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`
      ).bind(
        reference,
        key,
        digest,
        order.name,
        order.phone,
        order.service,
        order.date,
        order.recipient,
        order.recipientPhone,
        order.size,
        order.pickup,
        order.destination,
        order.package,
        now,
        now,
        shipment ? JSON.stringify(shipment) : null,
        requestHash
      ),
      context.env.DB.prepare(
        `INSERT INTO booking_events(id,reference,status,created_at) SELECT reference||':created',reference,'requested',created_at FROM bookings WHERE idempotency_key=? ON CONFLICT(id) DO NOTHING`
      ).bind(key),
    ]);
    const saved = await context.env.DB.prepare('SELECT * FROM bookings WHERE idempotency_key=?')
      .bind(key)
      .first();
    if (!(await matchesSaved(saved)))
      throw new HttpError(409, 'This request key was already used for different booking details.');
    return json(bookingResult(saved), saved.reference === reference ? 201 : 200);
  });
}
