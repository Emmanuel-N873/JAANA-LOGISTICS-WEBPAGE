import { endpoint, requireAdmin, rateLimit, body, text, REFERENCE, STATUSES, HttpError, json } from '../../../server/common.js';
export async function onRequest(context) {
  return endpoint(context, 'PATCH', async () => {
    await rateLimit(context, 'staff', 60, 60);
    await requireAdmin(context);
    const data = await body(context.request);
    const reference = text(data, 'reference').toUpperCase();
    const status = text(data, 'status');
    if (!REFERENCE.test(reference) || !Object.hasOwn(STATUSES, status) || !Number.isSafeInteger(data.version) || data.version < 1) throw new HttpError(400, 'Invalid reference, status or version.');
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = await context.env.DB.batch([
      context.env.DB.prepare(`INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ?,?,?,?,'booking.status_changed',reference,json_object('before',status,'after',?,'version',version+1),? FROM bookings WHERE reference=? AND version=?`).bind(eventId, context.staff.id, context.staff.name, context.staff.role, status, now, reference, data.version),
      context.env.DB.prepare('UPDATE bookings SET status=?,updated_at=?,version=version+1,last_update_id=? WHERE reference=? AND version=?').bind(status, now, eventId, reference, data.version),
      context.env.DB.prepare('INSERT INTO booking_events(id,reference,status,created_at) SELECT ?,reference,status,updated_at FROM bookings WHERE reference=? AND last_update_id=?').bind(eventId, reference, eventId)
    ]);
    if (!result[1].meta.changes) throw new HttpError(409, 'This booking has changed or no longer exists. Refresh the order list before updating.');
    return json({ reference, status, label: STATUSES[status], updatedAt: now, version: data.version + 1 });
  });
}
