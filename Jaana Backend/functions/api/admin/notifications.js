import { endpoint, rateLimit, body, text, REFERENCE, HttpError, json } from '../../../server/common.js';
import { requireStaff } from '../../../server/staff-auth.js';
export async function onRequest(context) {
 const method=context.request.method;
 if(!['GET','POST'].includes(method))return json({error:'Method not allowed.'},405,{Allow:'GET, POST'});
 return endpoint(context,method,async()=>{
  const actor=await requireStaff(context);
  await rateLimit(context,method==='GET'?'notification-poll':'notification-action',method==='GET'?240:60,60);
  const db=context.env.DB;
  if(method==='GET'){
   const params=new URL(context.request.url).searchParams;
   const page=Number(params.get('page')||1),after=params.has('after')?Number(params.get('after')):null;
   if(!Number.isSafeInteger(page)||page<1||page>100000||(after!==null&&(!Number.isSafeInteger(after)||after<0)))throw new HttpError(400,'Invalid notification page or cursor.');
   const selection=`SELECT n.id,n.reference,n.created_at,b.service,b.status,r.read_at,a.staff_id AS acknowledged_by,a.staff_name AS acknowledged_name,a.acknowledged_at FROM booking_notifications n JOIN bookings b ON b.reference=n.reference LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.staff_id=? LEFT JOIN booking_acknowledgements a ON a.reference=n.reference`;
   const statements=[
    db.prepare(selection+' ORDER BY n.id DESC LIMIT 30 OFFSET ?').bind(actor.id,(page-1)*30),
    db.prepare('SELECT COUNT(*) AS total,COALESCE(MAX(id),0) AS latestId FROM booking_notifications'),
    db.prepare('SELECT COUNT(*) AS unread FROM booking_notifications n WHERE NOT EXISTS(SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.staff_id=?)').bind(actor.id)
   ];
   if(after!==null)statements.push(db.prepare(selection+' WHERE n.id>? ORDER BY n.id LIMIT 50').bind(actor.id,after));
   const result=await db.batch(statements),meta=result[1].results[0],fresh=after===null?[]:result[3].results;
   return json({notifications:result[0].results,...meta,unread:result[2].results[0].unread,page,pageSize:30,fresh,cursor:after===null?meta.latestId:(fresh.at(-1)?.id??after),hasMoreFresh:fresh.length===50});
  }
  const data=await body(context.request),reference=text(data,'reference').toUpperCase();
  if(!REFERENCE.test(reference)||!['read','acknowledge'].includes(data.action))throw new HttpError(400,'Invalid notification action or reference.');
  const now=new Date().toISOString(),eventId=crypto.randomUUID();
  const notification=await db.prepare('SELECT id FROM booking_notifications WHERE reference=?').bind(reference).first();
  if(!notification)throw new HttpError(404,'Booking notification not found.');
  if(data.action==='read'){
   await db.batch([
    db.prepare('INSERT INTO notification_reads(notification_id,staff_id,read_at) VALUES(?,?,?) ON CONFLICT(notification_id,staff_id) DO NOTHING').bind(notification.id,actor.id,now),
    db.prepare("INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ?,?,?,?,'notification.read',?,'{}',? WHERE changes()=1").bind(eventId,actor.id,actor.name,actor.role,reference,now)
   ]);
   return json({ok:true});
  }
  await db.batch([
   db.prepare("INSERT INTO booking_acknowledgements(reference,staff_id,staff_name,acknowledged_at) SELECT reference,?,?,? FROM bookings WHERE reference=? AND status NOT IN ('delivered','cancelled') ON CONFLICT(reference) DO NOTHING").bind(actor.id,actor.name,now,reference),
   db.prepare("INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ?,?,?,?,'booking.acknowledged',?,'{}',? WHERE changes()=1").bind(eventId,actor.id,actor.name,actor.role,reference,now)
  ]);
  const acknowledgement=await db.prepare('SELECT staff_id,staff_name,acknowledged_at FROM booking_acknowledgements WHERE reference=?').bind(reference).first();
  if(!acknowledgement)throw new HttpError(409,'Delivered or cancelled bookings cannot be acknowledged.');
  if(acknowledgement.staff_id!==actor.id)throw new HttpError(409,'Another staff member has already acknowledged this booking. Refresh to see the latest details.');
  return json({acknowledgement});
 });
}
