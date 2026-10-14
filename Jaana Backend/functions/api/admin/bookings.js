import { endpoint, requireAdmin, rateLimit, STATUSES, lagosToday, HttpError, json } from '../../../server/common.js';
import { audit } from '../../../server/staff-auth.js';
export async function onRequest(context) {
  return endpoint(context, 'GET', async () => {
    await rateLimit(context, 'staff', 60, 60);
    await requireAdmin(context);
    const params = new URL(context.request.url).searchParams;
    const raw = Number(params.get('page') || 1);
    const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
    const search = (params.get('q') || '').trim();
    const status = params.get('status') || '';
    const area = (params.get('area') || '').trim();
    const date = params.get('date') || '';
    if (search.length > 120 || area.length > 80 || (status && !Object.hasOwn(STATUSES, status))) throw new HttpError(400, 'Invalid search or status filter.');
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new HttpError(400, 'Choose a valid delivery date.');
    const conditions = [], values = [];
    const pattern = value => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
    if (search) {
      conditions.push("(reference LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR pickup_address LIKE ? ESCAPE '\\' OR delivery_address LIKE ? ESCAPE '\\')");
      values.push(...Array(4).fill(pattern(search)));
    }
    if (status) { conditions.push('status=?'); values.push(status); }
    if (area) {
      conditions.push("(pickup_address LIKE ? ESCAPE '\\' OR delivery_address LIKE ? ESCAPE '\\')");
      values.push(pattern(area), pattern(area));
    }
    if (date) { conditions.push('delivery_date=?'); values.push(date); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const todayStart = new Date(`${lagosToday()}T00:00:00+01:00`).toISOString();
    const tomorrowStart = new Date(Date.parse(todayStart) + 86400000).toISOString();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(`SELECT reference,customer_name,service,delivery_date,pickup_address,delivery_address,status,created_at,updated_at,version FROM bookings${where} ORDER BY created_at DESC,reference DESC LIMIT 20 OFFSET ?`).bind(...values, (page - 1) * 20),
      context.env.DB.prepare(`SELECT COUNT(*) AS total FROM bookings${where}`).bind(...values),
      context.env.DB.prepare(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status IN ('picked_up','in_transit') THEN 1 ELSE 0 END),0) AS inProgress,
        COALESCE(SUM(CASE WHEN status='requested' THEN 1 ELSE 0 END),0) AS pending,
        COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) AS cancelled,
        COALESCE(SUM(CASE WHEN status='delivered' AND updated_at>=? AND updated_at<? THEN 1 ELSE 0 END),0) AS deliveredToday
        FROM bookings`).bind(todayStart, tomorrowStart)
    ]);
    const total = results[1].results[0].total;
    await audit(context, context.staff, 'bookings.list', '', { page, status, area, date, searched: !!search });
    return json({ bookings: results[0].results, page, pageSize: 20, total, hasMore: page * 20 < total, statuses: STATUSES, summary: results[2].results[0], areas: ['Ikeja','Victoria Island','Lekki','Surulere','Yaba','Ajah','Mushin','Festac','Alimosho'] });
  });
}
