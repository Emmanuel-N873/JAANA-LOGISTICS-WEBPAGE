import { endpoint,body,json,HttpError,rateLimit } from '../../server/common.js';
import { requireStaff,verifyPassword,auditStatement,sessionCookie } from '../../server/staff-auth.js';
import { newSecret,sealSecret,matchingCounter,verifySecondFactor,recoveryCodes } from '../../server/mfa.js';
export async function onRequest(context){
 return endpoint(context,'POST',async()=>{
  const actor=await requireStaff(context,false,true);
  if(actor.must_change_password)throw new HttpError(403,'Change your temporary password first.');
  await rateLimit(context,'mfa-management',10,900);
  const data=await body(context.request);
  if(typeof data.password!=='string'||data.password.length>128||!await verifyPassword(data.password,actor.password_hash))throw new HttpError(401,'Current password is incorrect.');
  if(data.action==='begin'){
   if(actor.mfa_secret)throw new HttpError(409,'Authenticator is already enabled.');
   const secret=newSecret();
   await context.env.DB.batch([
    context.env.DB.prepare('UPDATE staff_users SET mfa_pending=?,mfa_pending_exp=? WHERE id=? AND version=?').bind(await sealSecret(context.env,secret),new Date(Date.now()+600000).toISOString(),actor.id,actor.version),
    auditStatement(context,actor,'auth.mfa_setup_started',actor.id)
   ]);
   return json({secret,uri:'otpauth://totp/'+encodeURIComponent('JAANA Logistics:'+actor.email)+'?secret='+secret+'&issuer=JAANA%20Logistics&algorithm=SHA1&digits=6&period=30'});
  }
  if(data.action==='confirm'){
   if(actor.mfa_secret||!actor.mfa_pending||actor.mfa_pending_exp<=new Date().toISOString())throw new HttpError(400,'Authenticator setup expired. Start setup again.');
   const counter=await matchingCounter(context.env,actor.mfa_pending,data.code);
   if(counter===null)throw new HttpError(400,'The authenticator code is incorrect.');
   const generation=crypto.randomUUID();
   const recovery=await recoveryCodes(context,actor,generation);
   const result=await context.env.DB.batch([
    context.env.DB.prepare('UPDATE staff_users SET mfa_secret=mfa_pending,mfa_pending=NULL,mfa_pending_exp=NULL,mfa_counter=?,mfa_generation=?,version=version+1 WHERE id=? AND version=? AND mfa_secret IS NULL AND mfa_pending=?').bind(counter,generation,actor.id,actor.version,actor.mfa_pending),
    ...recovery.statements,
    context.env.DB.prepare('DELETE FROM staff_sessions WHERE staff_id=? AND EXISTS(SELECT 1 FROM staff_users WHERE id=? AND mfa_generation=?)').bind(actor.id,actor.id,generation),
    context.env.DB.prepare("INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ?,?,?,?,'auth.mfa_enabled',?,'{}',? WHERE EXISTS(SELECT 1 FROM staff_users WHERE id=? AND mfa_generation=?)").bind(crypto.randomUUID(),actor.id,actor.name,actor.role,actor.id,new Date().toISOString(),actor.id,generation)
   ]);
   if(!result[0].meta.changes)throw new HttpError(409,'Your account changed. Sign in and retry.');
   return json({recoveryCodes:recovery.codes},200,{'Set-Cookie':sessionCookie(context,'',0)});
  }
  if(data.action==='disable'){
   if(context.env.REQUIRE_STAFF_MFA==='true')throw new HttpError(403,'Authenticator verification is required for staff accounts.');
   if(!actor.mfa_secret)throw new HttpError(400,'Authenticator is not enabled.');
   await verifySecondFactor(context,actor,data.code);
   const generation=crypto.randomUUID();
   const result=await context.env.DB.batch([
    context.env.DB.prepare('UPDATE staff_users SET mfa_secret=NULL,mfa_pending=NULL,mfa_pending_exp=NULL,mfa_counter=-1,mfa_generation=?,version=version+1 WHERE id=? AND version=?').bind(generation,actor.id,actor.version),
    context.env.DB.prepare('DELETE FROM staff_recovery_codes WHERE staff_id=? AND EXISTS(SELECT 1 FROM staff_users WHERE id=? AND mfa_generation=?)').bind(actor.id,actor.id,generation),
    context.env.DB.prepare('DELETE FROM staff_sessions WHERE staff_id=? AND EXISTS(SELECT 1 FROM staff_users WHERE id=? AND mfa_generation=?)').bind(actor.id,actor.id,generation),
    context.env.DB.prepare("INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) SELECT ?,?,?,?,'auth.mfa_disabled',?,'{}',? WHERE EXISTS(SELECT 1 FROM staff_users WHERE id=? AND mfa_generation=?)").bind(crypto.randomUUID(),actor.id,actor.name,actor.role,actor.id,new Date().toISOString(),actor.id,generation)
   ]);
   if(!result[0].meta.changes)throw new HttpError(409,'Your account changed. Sign in and retry.');
   return json({ok:true},200,{'Set-Cookie':sessionCookie(context,'',0)});
  }
  throw new HttpError(400,'Unknown authenticator action.');
 });
}
