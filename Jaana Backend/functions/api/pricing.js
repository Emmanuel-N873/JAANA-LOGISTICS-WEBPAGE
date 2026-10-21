import { endpoint, body, json, HttpError, rateLimit } from '../../server/common.js';
import { requireStaff, auditStatement } from '../../server/staff-auth.js';
export const defaults = { perKm: 300, minimum: 2000 };
export async function pricing(context) {
 const row = await context.env.DB.prepare('SELECT per_km,minimum_charge FROM delivery_pricing WHERE id=1').first();
 return row ? { perKm: row.per_km, minimum: row.minimum_charge } : defaults;
}
export async function onRequest(context) {
 const method = context.request.method;
 return endpoint(context, method === 'PUT' ? 'PUT' : 'GET', async () => {
  if (method === 'PUT') {
   const user = await requireStaff(context, true);
   const data = await body(context.request);
   for (const field of ['perKm','minimum']) if (!Number.isSafeInteger(data[field]) || data[field] < 1 || data[field] > 10000000) throw new HttpError(400, 'Enter whole naira amounts between 1 and 10,000,000.');
   await context.env.DB.batch([
    context.env.DB.prepare('UPDATE delivery_pricing SET per_km=?,minimum_charge=?,updated_at=? WHERE id=1').bind(data.perKm,data.minimum,new Date().toISOString()),
    auditStatement(context,user,'pricing.updated','delivery',data)
   ]);
  }
  return json(await pricing(context));
 });
}
export function estimate(distanceKm, weight, rates) {
 const distanceCharge = Math.ceil(distanceKm * rates.perKm);
 const weightCharge = weight <= 5 ? 0 : weight <= 10 ? 500 : weight <= 15 ? 1000 : weight <= 20 ? 1500 : null;
 return { distanceCharge, minimumApplied: distanceCharge < rates.minimum, weightCharge, total: weightCharge === null ? null : Math.max(rates.minimum,distanceCharge)+weightCharge };
}
