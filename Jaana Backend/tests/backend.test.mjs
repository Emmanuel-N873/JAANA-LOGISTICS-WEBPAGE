import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest as create } from '../functions/api/bookings.js';
import { onRequest as lookup } from '../functions/api/delivery-status.js';
import { onRequest as list } from '../functions/api/admin/bookings.js';
import { onRequest as update } from '../functions/api/admin/status.js';
import { onRequest as details } from '../functions/api/admin/order.js';
import { lagosToday } from '../server/common.js';
import { createHash } from 'node:crypto';
import { onRequest as staffAuth } from '../functions/api/staff.js';
import { onRequest as staffAccounts } from '../functions/api/admin/staff.js';
import { onRequest as activity } from '../functions/api/admin/activity.js';
import { passwordHash, verifyPassword } from '../server/staff-auth.js';

// Execute the real migration and endpoint SQL against SQLite, matching D1's API.
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON;');
  sqlite.exec(readFileSync(new URL('../migrations/0001_orders.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_staff.sql', import.meta.url), 'utf8'));
  const TEST_SESSION = 'a'.repeat(64);
  sqlite.prepare('INSERT INTO staff_users(id,name,email,role,password_hash,must_change_password,created_at) VALUES(?,?,?,?,?,0,?)').run('test-admin','Test Administrator','admin@jaana.example','admin','unused',new Date().toISOString());
  sqlite.prepare('INSERT INTO staff_sessions(token_hash,staff_id,user_version,expires_at,created_at) VALUES(?,?,?,?,?)').run(createHash('sha256').update(TEST_SESSION).digest('hex'),'test-admin',1,new Date(Date.now()+3600000).toISOString(),new Date().toISOString());
  const prepare = (sql, values = []) => ({
    bind(...bound) { return prepare(sql, bound); },
    execute() {
      const results = sqlite.prepare(sql).all(...values);
      return { success: true, results, meta: { changes: sqlite.prepare('SELECT changes() n').get().n } };
    },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return this.execute(); }
  });
  const DB = { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { DB, TEST_SESSION, sqlite };
}
function dateAfterToday(days = 1) {
  const date = new Date(lagosToday() + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function order() {
  return { name: 'Test Customer', phone: '0803 842 2591', service: 'Document Delivery', date: dateAfterToday(), recipient: 'Recipient', recipientPhone: '+2348038422591', size: 'Envelope or document', pickup: 'Pickup address', destination: 'Delivery address', package: 'Confidential document' };
}
function call(handler, env, { method = 'POST', data, key = crypto.randomUUID(), token, origin, raw, contentType = 'application/json', query = '', ip = '192.0.2.10' } = {}) {
  const headers = { 'Content-Type': contentType, 'Idempotency-Key': key, 'CF-Connecting-IP': ip };
  if (token) headers.Cookie = `jaana_staff=${token}`;
  if (origin) headers.Origin = origin;
  const request = new Request('https://jaana.example/api/test' + query, { method, headers, ...(method !== 'GET' ? { body: raw ?? JSON.stringify(data ?? {}) } : {}) });
  return handler({ request, env });
}
test('booking persists all data and server-generated reference', async () => {
  const env = setup(), data = order();
  const response = await call(create, env, { data });
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.match(saved.reference, /^JAANA-\d{8}(?:-[A-F0-9]{6}){4}$/);
  assert.equal(saved.status, 'requested');
  const row = env.sqlite.prepare('SELECT * FROM bookings').get();
  assert.equal(row.customer_name, data.name); assert.equal(row.recipient_phone, data.recipientPhone);
  assert.equal(row.package_details, data.package); assert.equal(row.reference, saved.reference);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM booking_events').get().n, 1);
  env.sqlite.close();
});
test('concurrent retries create one booking and one creation event', async () => {
  const env = setup(), key = crypto.randomUUID(), data = order();
  const responses = await Promise.all([call(create, env, { key, data }), call(create, env, { key, data })]);
  const refs = await Promise.all(responses.map(response => response.json()));
  assert.equal(refs[0].reference, refs[1].reference);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM bookings').get().n, 1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM booking_events').get().n, 1);
  const conflict = await call(create, env, { key, data: { ...data, name: 'Other person' } });
  assert.equal(conflict.status, 409);
  env.sqlite.close();
});
test('different request keys receive different references', async () => {
  const env = setup();
  const a = await (await call(create, env, { data: order() })).json();
  const b = await (await call(create, env, { data: order() })).json();
  assert.notEqual(a.reference, b.reference); env.sqlite.close();
});
test('server rejects invalid, missing, past and Sunday booking fields', async () => {
  const sunday = new Date(dateAfterToday() + 'T12:00:00Z');
  sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7));
  for (const patch of [{ name: ' ' }, { phone: 'invalid' }, { service: 'Unknown' }, { date: '2000-01-01' }, { date: '2028-02-30' }, { date: sunday.toISOString().slice(0, 10) }, { recipientPhone: '' }, { package: 'x'.repeat(501) }]) {
    const env = setup(); assert.equal((await call(create, env, { data: { ...order(), ...patch } })).status, 400);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM bookings').get().n, 0); env.sqlite.close();
  }
});
test('method, origin, content type, body size and malformed JSON are enforced', async () => {
  const env = setup();
  assert.equal((await call(create, env, { method: 'GET' })).status, 405);
  assert.equal((await call(create, env, { origin: 'https://other.example', data: order() })).status, 403);
  assert.equal((await call(create, env, { contentType: 'text/plain', data: order() })).status, 415);
  assert.equal((await call(create, env, { raw: '{broken' })).status, 400);
  assert.equal((await call(create, env, { raw: ' '.repeat(17000) })).status, 413);
  env.sqlite.close();
});
test('booking rate limits are enforced', async () => {
  const env = setup();
  for (let i = 0; i < 10; i++) assert.equal((await call(create, env, { data: order() })).status, 201);
  assert.equal((await call(create, env, { data: order() })).status, 429); env.sqlite.close();
});

test('delivery status rate limits are enforced', async () => {
  const env = setup();

  try {
    for (let i = 0; i < 30; i++) {
      const response = await call(lookup, env, {
        data: { reference: 'invalid' }
      });

      assert.equal(response.status, 400);
    }

    const blocked = await call(lookup, env, {
      data: { reference: 'invalid' }
    });

    assert.equal(blocked.status, 429);
  } finally {
    env.sqlite.close();
  }
});
test('public status returns no customer data', async () => {
  const env = setup();
  const { reference } = await (await call(create, env, { data: order() })).json();
  const response = await call(lookup, env, { data: { reference: reference.toLowerCase() } });
  const status = await response.json();
  assert.equal(response.status, 200); assert.equal(status.status, 'requested');
  assert.deepEqual(Object.keys(status).sort(), ['label', 'reference', 'status', 'updatedAt']);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await call(lookup, env, { data: { reference: 'invalid' } })).status, 400);
  assert.equal((await call(lookup, env, { data: { reference: 'JAANA-20260101-AAAAAA-AAAAAA-AAAAAA-AAAAAA' } })).status, 404);
  env.sqlite.close();
});
test('staff authentication, status changes, audit and optimistic concurrency', async () => {
  const env = setup(), token = env.TEST_SESSION;
  const { reference } = await (await call(create, env, { data: order() })).json();
  assert.equal((await call(list, env, { method: 'GET' })).status, 401);
  assert.equal((await call(update, env, { method: 'PATCH', data: { reference, status: 'delivered', version: 1 }, token: 'wrong' })).status, 401);
  const rows = await (await call(list, env, { method: 'GET', token })).json();
  assert.equal(rows.bookings.length, 1); assert.equal(rows.bookings[0].customer_name, 'Test Customer');
  assert.equal((await call(update, env, { method: 'PATCH', token, data: { reference, status: 'confirmed', version: 1 } })).status, 200);
  assert.equal((await call(update, env, { method: 'PATCH', token, data: { reference, status: 'cancelled', version: 1 } })).status, 409);
  assert.equal((await call(update, env, { method: 'PATCH', token, data: { reference, status: 'unknown', version: 2 } })).status, 400);
  const status = await (await call(lookup, env, { data: { reference } })).json();
  assert.equal(status.status, 'confirmed');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM booking_events').get().n, 2);
  env.sqlite.close();
});
test('missing database and inactive staff fail closed', async () => {
  assert.equal((await call(create, {}, { data: order() })).status, 503);
  const env = setup(); env.sqlite.prepare('UPDATE staff_users SET active=0').run();
  assert.equal((await call(list, env, { method: 'GET', token: env.TEST_SESSION })).status, 401); env.sqlite.close();
});

test('cancelled orders have a global count and a dedicated status filter', async () => {
  const env = setup(), token = env.TEST_SESSION;
  const saved = await (await call(create, env, { data: order() })).json();
  await call(create, env, { data: order() });
  const initial = await (await call(list, env, { method: 'GET', token })).json();
  assert.equal(initial.summary.cancelled, 0);
  const response = await call(update, env, { method: 'PATCH', token, data: { reference: saved.reference, status: 'cancelled', version: 1 } });
  assert.equal(response.status, 200);
  const cancelled = await (await call(list, env, { method: 'GET', token, query: '?status=cancelled' })).json();
  assert.equal(cancelled.total, 1); assert.equal(cancelled.summary.cancelled, 1);
  assert.equal(cancelled.summary.total, 2); assert.equal(cancelled.summary.pending, 1);
  assert.equal(cancelled.bookings[0].reference, saved.reference);
  const pending = await (await call(list, env, { method: 'GET', token, query: '?status=requested' })).json();
  assert.equal(pending.summary.cancelled, 1);
  env.sqlite.close();
});

test('staff search, filters and pagination run across the complete order set', async () => {
  const env = setup(), token = env.TEST_SESSION;
  const refs = [];
  for (let i = 0; i < 23; i++) {
    const data = { ...order(), name: i === 0 ? 'Market%Shop' : `Customer ${i}`, pickup: i % 2 ? 'Yaba office' : 'Ikeja warehouse', destination: 'Lekki delivery' };
    refs.push((await (await call(create, env, { data, ip: `192.0.2.${i + 20}` })).json()).reference);
    if (i % 3 === 1) env.sqlite.prepare("UPDATE bookings SET status='in_transit' WHERE reference=?").run(refs[i]);
  }
  const get = async query => (await call(list, env, { method: 'GET', token, query })).json();
  const first = await get('');
  assert.equal(first.total, 23); assert.equal(first.bookings.length, 20); assert.equal(first.hasMore, true);
  assert.equal(first.summary.total, 23); assert.equal(first.summary.inProgress, 8); assert.equal(first.summary.pending, 15);
  const second = await get('?page=2'); assert.equal(second.bookings.length, 3); assert.equal(second.hasMore, false);
  const found = await get('?q=' + encodeURIComponent('customer 22'));
  assert.equal(found.total, 1); assert.equal(found.bookings[0].reference, refs[22]);
  const byReference = await get('?q=' + refs[0]); assert.equal(byReference.total, 1);
  const filtered = await get('?status=in_transit&area=Ikeja&date=' + order().date);
  assert.equal(filtered.total, 4); assert.equal(filtered.summary.total, 23);
  assert(filtered.bookings.every(row => row.status === 'in_transit' && row.pickup_address.includes('Ikeja')));
  assert.equal((await get('?q=' + encodeURIComponent('%'))).total, 1);
  assert.equal((await get('?q=' + encodeURIComponent('_'))).total, 0);
  assert.equal((await get('?q=' + encodeURIComponent("' OR 1=1 --"))).total, 0);
  assert.equal((await get('?q=NoSuchCustomer')).total, 0);
  env.sqlite.close();
});

test('staff filters validate status, date and search length', async () => {
  const env = setup(), token = env.TEST_SESSION;
  for (const query of ['?status=not-a-status', '?date=2026-02-31', '?q=' + 'a'.repeat(121), '?area=' + 'x'.repeat(81)]) {
    assert.equal((await call(list, env, { method: 'GET', token, query })).status, 400);
  }
  env.sqlite.close();
});

test('staff detail lookup protects customer data and includes versioned history', async () => {
  const env = setup(), token = env.TEST_SESSION;
  const { reference } = await (await call(create, env, { data: order() })).json();
  const query = '?reference=' + reference;
  assert.equal((await call(details, env, { method: 'GET', query })).status, 401);
  await call(update, env, { method: 'PATCH', token, data: { reference, status: 'confirmed', version: 1 } });
  const response = await call(details, env, { method: 'GET', token, query });
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(data.order.customer_phone, order().phone); assert.equal(data.order.package_details, order().package);
  assert.equal(data.order.version, 2); assert.equal(data.events.length, 2);
  assert(data.events.some(event => event.status === 'confirmed'));
  assert(!('idempotency_key' in data.order)); assert(!('payload_hash' in data.order));
  assert.equal((await call(details, env, { method: 'GET', token, query: '?reference=bad' })).status, 400);
  assert.equal((await call(details, env, { method: 'GET', token, query: '?reference=JAANA-20260101-AAAAAA-AAAAAA-AAAAAA-AAAAAA' })).status, 404);
  env.sqlite.close();
});

test('delivered-today summary uses the Lagos day boundary', async () => {
  const env = setup(), token = env.TEST_SESSION;
  const first = await (await call(create, env, { data: order() })).json();
  const second = await (await call(create, env, { data: order() })).json();
  const start = Date.parse(lagosToday() + 'T00:00:00+01:00');
  env.sqlite.prepare("UPDATE bookings SET status='delivered',updated_at=? WHERE reference=?").run(new Date(start + 1000).toISOString(), first.reference);
  env.sqlite.prepare("UPDATE bookings SET status='delivered',updated_at=? WHERE reference=?").run(new Date(start - 1000).toISOString(), second.reference);
  const data = await (await call(list, env, { method: 'GET', token })).json();
  assert.equal(data.summary.deliveredToday, 1); env.sqlite.close();
});


async function loginAccount(env, email='admin@jaana.example', password='Local test password 123!') {
 env.sqlite.prepare('UPDATE staff_users SET password_hash=? WHERE id=?').run(await passwordHash(password),'test-admin');
 const response=await call(staffAuth,env,{query:'?action=login',data:{email,password}});assert.equal(response.status,200);
 return {token:response.headers.get('Set-Cookie').match(/jaana_staff=([^;]+)/)[1],response};
}
const cookieToken=response=>response.headers.get('Set-Cookie').match(/jaana_staff=([^;]+)/)[1];
test('individual sign-in uses private cookies and logs sign-in, failure and sign-out without credentials',async()=>{
 const env=setup(),{token,response}=await loginAccount(env);
 assert.match(response.headers.get('Set-Cookie'),/HttpOnly; SameSite=Strict/);assert.match(response.headers.get('Set-Cookie'),/; Secure/);
 const data=await response.json();assert.equal(data.user.name,'Test Administrator');assert.equal(data.user.password_hash,undefined);
 assert(await verifyPassword('Local test password 123!',env.sqlite.prepare('SELECT password_hash FROM staff_users').get().password_hash));
 assert.equal((await call(staffAuth,env,{query:'?action=login',data:{email:'admin@jaana.example',password:'wrong'}})).status,401);
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM staff_audit WHERE action='auth.login_failed'").get().n,1);
 assert.equal((await call(staffAuth,env,{method:'GET',token})).status,200);
 assert.equal((await call(staffAuth,env,{query:'?action=logout',token,data:{}})).status,200);
 assert.equal((await call(list,env,{method:'GET',token})).status,401);
 const audit=env.sqlite.prepare('SELECT details FROM staff_audit').all().map(r=>r.details).join('');assert(!audit.includes('Local test password'));assert(!audit.includes(token));env.sqlite.close();
});
test('staff must replace temporary passwords and cannot manage accounts or read administrator logs',async()=>{
 const env=setup(),admin=env.TEST_SESSION;
 assert.equal((await call(staffAccounts,env,{token:admin,data:{action:'create',name:'Jane Rider',email:'jane@jaana.example',role:'staff',password:'Temporary password 123!'}})).status,201);
 const signIn=await call(staffAuth,env,{query:'?action=login',data:{email:'jane@jaana.example',password:'Temporary password 123!'}});assert.equal(signIn.status,200);
 const token=cookieToken(signIn);assert.equal((await signIn.json()).user.mustChangePassword,true);
 assert.equal((await call(list,env,{method:'GET',token})).status,403);
 assert.equal((await call(staffAuth,env,{query:'?action=password',token,data:{currentPassword:'Temporary password 123!',password:'Private new password 123!'}})).status,200);
 assert.equal((await call(staffAuth,env,{method:'GET',token})).status,401);
 const next=await call(staffAuth,env,{query:'?action=login',data:{email:'jane@jaana.example',password:'Private new password 123!'}});const session=cookieToken(next);
 assert.equal((await call(list,env,{method:'GET',token:session})).status,200);
 assert.equal((await call(staffAccounts,env,{method:'GET',token:session})).status,403);assert.equal((await call(activity,env,{method:'GET',token:session})).status,403);
 const {reference}=await (await call(create,env,{data:order()})).json();
 assert.equal((await call(update,env,{method:'PATCH',token:session,data:{reference,status:'confirmed',version:1}})).status,200);
 const record=env.sqlite.prepare("SELECT * FROM staff_audit WHERE action='booking.status_changed'").get();assert.equal(record.staff_name,'Jane Rider');assert.equal(record.target,reference);assert.deepEqual(JSON.parse(record.details),{before:'requested',after:'confirmed',version:2});
 await call(update,env,{method:'PATCH',token:session,data:{reference,status:'delivered',version:1}});assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM staff_audit WHERE action='booking.status_changed'").get().n,1);env.sqlite.close();
});
test('reset and disable revoke sessions, stale edits conflict and administrator cannot disable self',async()=>{
 const env=setup(),token=env.TEST_SESSION;
 assert.equal((await call(staffAccounts,env,{token,data:{action:'update',id:'test-admin',version:1,name:'Admin',role:'staff',active:false}})).status,400);
 await call(staffAccounts,env,{token,data:{action:'create',name:'Staff Person',email:'person@jaana.example',role:'staff',password:'Temporary password 123!'}});
 const user=env.sqlite.prepare("SELECT * FROM staff_users WHERE email='person@jaana.example'").get();env.sqlite.prepare('UPDATE staff_users SET must_change_password=0 WHERE id=?').run(user.id);
 const login=await call(staffAuth,env,{query:'?action=login',data:{email:user.email,password:'Temporary password 123!'}});const session=cookieToken(login);
 assert.equal((await call(staffAccounts,env,{token,data:{action:'reset',id:user.id,version:1,password:'Reset temporary password 123!'}})).status,200);
 assert.equal((await call(staffAuth,env,{method:'GET',token:session})).status,401);
 assert.equal((await call(staffAccounts,env,{token,data:{action:'update',id:user.id,version:1,name:user.name,role:'staff',active:false}})).status,409);
 assert.equal((await call(staffAccounts,env,{token,data:{action:'update',id:user.id,version:2,name:user.name,role:'staff',active:false}})).status,200);
 assert.equal((await call(staffAuth,env,{query:'?action=login',data:{email:user.email,password:'Reset temporary password 123!'}})).status,401);env.sqlite.close();
});
test('activity search attributes order views and SQL triggers reject changes to audit records',async()=>{
 const env=setup(),token=env.TEST_SESSION;const {reference}=await (await call(create,env,{data:order()})).json();await call(details,env,{method:'GET',token,query:'?reference='+reference});
 const response=await call(activity,env,{method:'GET',token,query:'?q='+reference+'&action=booking.view&staff=test-admin'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.total,1);assert.equal(data.events[0].staff_name,'Test Administrator');
 assert.throws(()=>env.sqlite.exec("UPDATE staff_audit SET staff_name='Fake'"),/cannot be edited/);assert.throws(()=>env.sqlite.exec('DELETE FROM staff_audit'),/cannot be deleted/);env.sqlite.close();
});
test('legacy bearer authentication, expired sessions and cross-origin requests are denied',async()=>{
 const env=setup(),token=env.TEST_SESSION;
 assert.equal((await list({env,request:new Request('https://jaana.example/api/admin/bookings',{headers:{Authorization:'Bearer '+token}})})).status,401);
 assert.equal((await call(list,env,{method:'GET',token,origin:'https://evil.example'})).status,403);
 env.sqlite.prepare("UPDATE staff_sessions SET expires_at='2000-01-01T00:00:00Z'").run();assert.equal((await call(list,env,{method:'GET',token})).status,401);env.sqlite.close();
});
test('login attempts are limited per account across different IPs',async()=>{
 const env=setup();await loginAccount(env);
 for(let i=0;i<9;i++)assert.equal((await call(staffAuth,env,{query:'?action=login',data:{email:'admin@jaana.example',password:'wrong'},ip:'192.0.2.'+(20+i)})).status,401);
 assert.equal((await call(staffAuth,env,{query:'?action=login',data:{email:'admin@jaana.example',password:'wrong'},ip:'192.0.2.100'})).status,429);env.sqlite.close();
});
