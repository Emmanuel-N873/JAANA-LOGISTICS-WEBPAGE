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
    // Quote tokens as FTS literals: user input cannot become query syntax.
    const expression=value=>{
      const tokens=value.match(/[\p{L}\p{N}]+/gu)||[];
      return tokens.length?'"'+tokens.join(' ')+'"*':'';
    };
    if(search){const match=expression(search);if(match){conditions.push('rowid IN (SELECT rowid FROM bookings_search WHERE bookings_search MATCH ?)');values.push(match);}else{conditions.push('(instr(reference,?)>0 OR instr(customer_name,?)>0 OR instr(pickup_address,?)>0 OR instr(delivery_address,?)>0)');values.push(...Array(4).fill(search));}}
    if (status) { conditions.push('status=?'); values.push(status); }
    if(area){const match=expression(area);conditions.push(match?'rowid IN (SELECT rowid FROM bookings_search WHERE bookings_search MATCH ?)':'0');if(match)values.push('{pickup_address delivery_address} : ('+match+')');}
    if (date) { conditions.push('delivery_date=?'); values.push(date); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const todayStart = new Date(`${lagosToday()}T00:00:00+01:00`).toISOString();
    const tomorrowStart = new Date(Date.parse(todayStart) + 86400000).toISOString();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(`SELECT reference,customer_name,service,delivery_date,pickup_address,delivery_address,status,created_at,updated_at,version FROM bookings${where} ORDER BY created_at DESC,reference DESC LIMIT 20 OFFSET ?`).bind(...values, (page - 1) * 20),
      context.env.DB.prepare(`SELECT COUNT(*) AS total FROM bookings${where}`).bind(...values),
      context.env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM bookings) AS total,
        (SELECT COUNT(*) FROM bookings WHERE status IN ('picked_up','in_transit')) AS inProgress,
        (SELECT COUNT(*) FROM bookings WHERE status='requested') AS pending,
        (SELECT COUNT(*) FROM bookings WHERE status='cancelled') AS cancelled,
        (SELECT COUNT(*) FROM bookings WHERE status='delivered' AND updated_at>=? AND updated_at<?) AS deliveredToday`).bind(todayStart,tomorrowStart)
    ]);
    const total = results[1].results[0].total;
    await audit(context, context.staff, 'bookings.list', '', { page, status, area, date, searched: !!search });
    return json({ bookings: results[0].results, page, pageSize: 20, total, hasMore: page * 20 < total, statuses: STATUSES, summary: results[2].results[0], areas: ['Ikeja','Victoria Island','Lekki','Surulere','Yaba','Ajah','Mushin','Festac','Alimosho'] });
  });
}
