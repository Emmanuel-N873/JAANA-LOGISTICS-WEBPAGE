import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest as create } from '../functions/api/bookings.js';
import { onRequest as lookup } from '../functions/api/delivery-status.js';
import { onRequest as list } from '../functions/api/admin/bookings.js';
import { onRequest as update } from '../functions/api/admin/status.js';
import { lagosToday } from '../server/common.js';

// Execute the real migration and endpoint SQL against SQLite, matching D1's API.
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON;');
  sqlite.exec(readFileSync(new URL('../migrations/0001_orders.sql', import.meta.url), 'utf8'));
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
  return { DB, ADMIN_API_TOKEN: 'test-only-token-' + 'x'.repeat(40), sqlite };
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
function call(handler, env, { method = 'POST', data, key = crypto.randomUUID(), token, origin, raw, contentType = 'application/json' } = {}) {
  const headers = { 'Content-Type': contentType, 'Idempotency-Key': key, 'CF-Connecting-IP': '192.0.2.10' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const request = new Request('https://jaana.example/api/test', { method, headers, ...(method !== 'GET' ? { body: raw ?? JSON.stringify(data ?? {}) } : {}) });
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
  const env = setup(), token = env.ADMIN_API_TOKEN;
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
test('missing database or staff secret fails closed', async () => {
  assert.equal((await call(create, {}, { data: order() })).status, 503);
  const env = setup(); delete env.ADMIN_API_TOKEN;
  assert.equal((await call(list, env, { method: 'GET' })).status, 503); env.sqlite.close();
});
