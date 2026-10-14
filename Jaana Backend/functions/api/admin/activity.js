import { endpoint, rateLimit, json, HttpError } from '../../../server/common.js';
import { requireStaff, audit } from '../../../server/staff-auth.js';
export async function onRequest(context) {
 return endpoint(context,'GET',async()=>{
  await rateLimit(context,'staff',60,60);const actor=await requireStaff(context,true);
  const p=new URL(context.request.url).searchParams;
  const q=(p.get('q')||'').trim(),action=p.get('action')||'',actorId=p.get('staff')||'';
  if(q.length>120||action.length>80||actorId.length>80) throw new HttpError(400,'Search is too long.');
  const page=Math.max(1,Math.min(100000,Number(p.get('page'))||1));
  if(!Number.isInteger(page)) throw new HttpError(400,'Invalid page.');
  const where=[],values=[];
  if(q){where.push("(staff_name LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')");const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';values.push(pattern,pattern,pattern);}
  if(action){where.push('action=?');values.push(action);}
  if(actorId){where.push('staff_id=?');values.push(actorId);}
  const clause=where.length?' WHERE '+where.join(' AND '):'';
  await audit(context,actor,'audit.view');
  const results=await context.env.DB.batch([
   context.env.DB.prepare('SELECT * FROM staff_audit'+clause+' ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?').bind(...values,(page-1)*30),
   context.env.DB.prepare('SELECT COUNT(*) AS total FROM staff_audit'+clause).bind(...values)
  ]);
  return json({events:results[0].results,total:results[1].results[0].total,page,pageSize:30});
 });
}
