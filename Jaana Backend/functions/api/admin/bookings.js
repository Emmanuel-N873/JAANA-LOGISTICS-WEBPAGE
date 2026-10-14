import { endpoint, requireAdmin, rateLimit, STATUSES, json } from '../../../server/common.js';
export async function onRequest(context) {
  return endpoint(context, 'GET', async () => {
    await rateLimit(context, 'staff', 60, 60);
    await requireAdmin(context);
    const raw = Number(new URL(context.request.url).searchParams.get('page') || 1);
    const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
    const result = await context.env.DB.prepare(`SELECT reference,customer_name,customer_phone,service,delivery_date,recipient_name,recipient_phone,package_size,pickup_address,delivery_address,package_details,status,created_at,updated_at,version FROM bookings ORDER BY created_at DESC,reference DESC LIMIT 21 OFFSET ?`).bind((page - 1) * 20).all();
    return json({ bookings: result.results.slice(0, 20), page, hasMore: result.results.length > 20, statuses: STATUSES });
  });
}
