import { HttpError, hash } from './common.js';
const encoder = new TextEncoder();
export const COOKIE = 'jaana_staff';
export const safeUser = user => ({ id:user.id, name:user.name, email:user.email, role:user.role, active:!!user.active, mustChangePassword:!!user.must_change_password, version:user.version });
const hex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
export function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 14 || value.length > 128) throw new HttpError(400,'Use a password of 14 to 128 characters.');
  return value;
}
export function emailValue(value) {
  if(typeof value!=='string' || value.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new HttpError(400,'Enter a valid email address.');
  return value.trim().toLowerCase();
}
export async function passwordHash(password, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2-sha256$100000$${salt}$${hex(bits)}`;
}
export async function verifyPassword(password, stored) {
  const parts=stored.split('$');
  if(parts.length!==4 || parts[0]!=='pbkdf2-sha256' || parts[1]!=='100000') return false;
  const actual=await passwordHash(password,parts[2]);
  let difference=actual.length^stored.length;
  for(let i=0;i<actual.length;i++) difference|=actual.charCodeAt(i)^stored.charCodeAt(i);
  return difference===0;
}
export function auditStatement(context, actor, action, target='', details={}) {
  return context.env.DB.prepare('INSERT INTO staff_audit(id,staff_id,staff_name,staff_role,action,target,details,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),actor?.id||null,actor?.name||'Unauthenticated',actor?.role||'none',action,target,JSON.stringify(details),new Date().toISOString());
}
export async function audit(context, actor, action, target='', details={}) { await context.env.DB.batch([auditStatement(context,actor,action,target,details)]); }
export function sessionCookie(context, token='', maxAge=28800) {
  const url=new URL(context.request.url);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!local) throw new HttpError(400,'Staff sign-in requires HTTPS.');
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol==='https:'?'; Secure':''}`;
}
export async function sessionHash(context) {
  const cookie=context.request.headers.get('Cookie')||'';
  const value=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
  if(!/^[a-f0-9]{64}$/.test(value)) throw new HttpError(401,'Please sign in with your staff account.');
  return hash(value);
}
export async function requireStaff(context, adminOnly=false, allowPasswordChange=false) {
  if(context.request.headers.get('Sec-Fetch-Site')==='cross-site') throw new HttpError(403,'Cross-site requests are not allowed.');
  const tokenHash=await sessionHash(context);
  const user=await context.env.DB.prepare(`SELECT u.*,s.token_hash FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND s.user_version=u.version`).bind(tokenHash,new Date().toISOString()).first();
  if(!user) throw new HttpError(401,'Your session has expired. Please sign in again.');
  if(adminOnly&&user.role!=='admin') { await audit(context,user,'access.denied',new URL(context.request.url).pathname); throw new HttpError(403,'Administrator access is required.'); }
  if(user.must_change_password&&!allowPasswordChange) throw new HttpError(403,'Change your temporary password before continuing.');
  context.staff=user;
  return user;
}
