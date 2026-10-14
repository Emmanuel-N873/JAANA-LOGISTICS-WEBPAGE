import { endpoint, body, text, rateLimit, json, HttpError } from '../../../server/common.js';
import { requireStaff, safeUser, emailValue, passwordValue, passwordHash, audit, auditStatement } from '../../../server/staff-auth.js';
export async function onRequest(context) {
 const method=context.request.method;
 if(!['GET','POST'].includes(method)) return json({error:'Method not allowed.'},405,{Allow:'GET, POST'});
 return endpoint(context,method,async()=>{
  await rateLimit(context,'staff',60,60);
  const actor=await requireStaff(context,true);
  if(method==='GET') {
   const rows=await context.env.DB.prepare('SELECT id,name,email,role,active,must_change_password,version,created_at FROM staff_users ORDER BY name LIMIT 500').all();
   await audit(context,actor,'staff.list'); return json({users:rows.results.map(safeUser)});
  }
  const data=await body(context.request);
  if(data.action==='create') {
   const name=text(data,'name',100), email=emailValue(data.email), role=text(data,'role');
   if(!['admin','staff'].includes(role)) throw new HttpError(400,'Choose a valid staff role.');
   const digest=await passwordHash(passwordValue(data.password));
   const id=crypto.randomUUID();
   if(await context.env.DB.prepare('SELECT id FROM staff_users WHERE email=?').bind(email).first()) throw new HttpError(409,'This email already has an account.');
   await context.env.DB.batch([
    context.env.DB.prepare('INSERT INTO staff_users(id,name,email,role,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(id,name,email,role,digest,new Date().toISOString()),
    auditStatement(context,actor,'staff.created',id,{name,email,role})
   ]);
   return json({ok:true},201);
  }
  const id=text(data,'id'), target=await context.env.DB.prepare('SELECT * FROM staff_users WHERE id=?').bind(id).first();
  if(!target) throw new HttpError(404,'Staff account not found.');
  if(!Number.isSafeInteger(data.version)||data.version!==target.version) throw new HttpError(409,'Account changed. Refresh and retry.');
  let statement,details;
  if(data.action==='reset') {
   const digest=await passwordHash(passwordValue(data.password));
   statement=context.env.DB.prepare('UPDATE staff_users SET password_hash=?,must_change_password=1,version=version+1 WHERE id=? AND version=?').bind(digest,id,data.version);
   details={passwordReset:true};
  } else if(data.action==='update') {
   const name=text(data,'name',100),role=text(data,'role');
   if(!['admin','staff'].includes(role)||typeof data.active!=='boolean') throw new HttpError(400,'Invalid role or active state.');
   if(actor.id===id&&(!data.active||role!=='admin')) throw new HttpError(400,'You cannot disable or demote your own administrator account.');
   statement=context.env.DB.prepare(`UPDATE staff_users SET name=?,role=?,active=?,version=version+1 WHERE id=? AND version=? AND (role!='admin' OR active=0 OR (?='admin' AND ?=1) OR (SELECT COUNT(*) FROM staff_users WHERE role='admin' AND active=1)>1)`).bind(name,role,Number(data.active),id,data.version,role,Number(data.active));
   details={before:{name:target.name,role:target.role,active:!!target.active},after:{name,role,active:data.active}};
  } else throw new HttpError(400,'Unknown staff action.');
  const eventId=crypto.randomUUID();
  const result=await context.env.DB.batch([
   statement,
   context.env.DB.prepare('INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1').bind(eventId,actor.id,actor.name,actor.role,'staff.'+data.action,id,JSON.stringify(details),new Date().toISOString()),
   context.env.DB.prepare('DELETE FROM staff_sessions WHERE staff_id=? AND user_version<> (SELECT version FROM staff_users WHERE id=?)').bind(id,id)
  ]);
  if(!result[0].meta.changes) throw new HttpError(409,'Account changed or the last administrator must stay active. Refresh and retry.');
  return json({ok:true});
 });
}
