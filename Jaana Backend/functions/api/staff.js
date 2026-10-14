import { endpoint, body, text, rateLimit, json, HttpError, hash } from '../../server/common.js';
import { requireStaff, safeUser, passwordValue, passwordHash, verifyPassword, emailValue, audit, auditStatement, sessionHash, sessionCookie } from '../../server/staff-auth.js';

export async function onRequest(context) {
  const method=context.request.method;
  if(!['GET','POST'].includes(method)) return json({error:'Method not allowed.'},405,{Allow:'GET, POST'});
  return endpoint(context,method,async()=>{
    const action=new URL(context.request.url).searchParams.get('action')||'me';
    if(method==='GET') {
      const user=await requireStaff(context,false,true);
      return json({user:safeUser(user)});
    }
    const data=await body(context.request);
    if(action==='login') {
      await rateLimit(context,'staff-login',10,900);
      const email=emailValue(data.email), password=typeof data.password==='string'&&data.password.length<=128?data.password:'';
      const accountContext={...context,request:new Request(context.request.url,{headers:{'CF-Connecting-IP':email}})};
      await rateLimit(accountContext,'staff-login-account',10,900);
      const user=await context.env.DB.prepare('SELECT * FROM staff_users WHERE email=?').bind(email).first();
      const dummy='pbkdf2-sha256$100000$00000000000000000000000000000000$'+'0'.repeat(64);
      const valid=await verifyPassword(password,user?.password_hash||dummy);
      if(!user||!valid||!user.active) {
        await audit(context,user,'auth.login_failed',user?.id||'',{attemptedEmail:email});
        throw new HttpError(401,'Email or password is incorrect.');
      }
      const token=[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
      const now=new Date().toISOString(), expires=new Date(Date.now()+28800000).toISOString();
      const cookie=sessionCookie(context,token);
      await context.env.DB.batch([
        context.env.DB.prepare('DELETE FROM staff_sessions WHERE expires_at<=?').bind(now),
        context.env.DB.prepare('INSERT INTO staff_sessions(token_hash,staff_id,user_version,expires_at,created_at) VALUES(?,?,?,?,?)').bind(await hash(token),user.id,user.version,expires,now),
        auditStatement(context,user,'auth.login',user.id)
      ]);
      return json({user:safeUser(user)},200,{'Set-Cookie':cookie});
    }
    const actor=await requireStaff(context,false,true);
    if(action==='logout') {
      await context.env.DB.batch([context.env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash=?').bind(await sessionHash(context)),auditStatement(context,actor,'auth.logout',actor.id)]);
      return json({ok:true},200,{'Set-Cookie':sessionCookie(context,'',0)});
    }
    if(action==='password') {
      await rateLimit(context,'staff-password',5,900);
      if(typeof data.currentPassword!=='string'||data.currentPassword.length>128||!await verifyPassword(data.currentPassword,actor.password_hash)) {
        await audit(context,actor,'auth.password_failed',actor.id); throw new HttpError(400,'Current password is incorrect.');
      }
      const next=passwordValue(data.password);
      if(await verifyPassword(next,actor.password_hash)) throw new HttpError(400,'Choose a different password.');
      await context.env.DB.batch([
        context.env.DB.prepare('UPDATE staff_users SET password_hash=?,must_change_password=0,version=version+1 WHERE id=?').bind(await passwordHash(next),actor.id),
        context.env.DB.prepare('DELETE FROM staff_sessions WHERE staff_id=?').bind(actor.id),
        auditStatement(context,actor,'auth.password_changed',actor.id)
      ]);
      return json({ok:true},200,{'Set-Cookie':sessionCookie(context,'',0)});
    }
    throw new HttpError(400,'Unknown account action.');
  });
}
