export const STATUSES = {
  requested: 'Request received', confirmed: 'Booking confirmed', picked_up: 'Picked up',
  in_transit: 'In transit', delivered: 'Delivered', cancelled: 'Cancelled'
};
export const REFERENCE = /^JAANA-\d{8}(?:-[A-F0-9]{6}){4}$/;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...extra
  } });
}
export async function endpoint(context, method, callback) {
  try {
    if (context.request.method !== method) return json({ error: 'Method not allowed.' }, 405, { Allow: method });
    const origin = context.request.headers.get('Origin');
    if (origin && origin !== new URL(context.request.url).origin) throw new HttpError(403, 'Cross-site requests are not allowed.');
    if (!context.env.DB) throw new HttpError(503, 'Booking service is not configured. Please contact JAANA on WhatsApp.');
    return await callback();
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    // Avoid recording customer data or credentials in logs and public errors.
    console.error('JAANA API request failed:', error.name);
    return json({ error: 'The service is temporarily unavailable. Please retry or contact JAANA on WhatsApp.' }, 503);
  }
}
export async function body(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON request data.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request data is required.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) { await reader.cancel(); throw new HttpError(413, 'Request is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON data.'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new HttpError(400, 'Invalid request data.');
  return data;
}
export function text(data, key, max = 100) {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    throw new HttpError(400, `Please provide a valid ${key}.`);
  }
  return value.trim();
}
export function lagosToday() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function rateLimit(context, action, limit, seconds) {
  const now = Math.floor(Date.now() / 1000);
  const ip = context.request.headers.get('CF-Connecting-IP') || 'local-development';
  const bucket = `${action}:${await hash(ip)}:${Math.floor(now / seconds)}`;
  const result = await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM api_rate_limits WHERE expires_at < ?').bind(now),
    context.env.DB.prepare('INSERT INTO api_rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket, now + seconds)
  ]);
  if (result[1].results[0].hits > limit) throw new HttpError(429, 'Too many requests. Please wait a few minutes and retry.');
}
export async function requireAdmin(context) {
  const expected = context.env.ADMIN_API_TOKEN;
  if (typeof expected !== 'string' || expected.length < 32) throw new HttpError(503, 'Staff access is not configured.');
  const header = context.request.headers.get('Authorization') || '';
  if (header.length > 512) throw new HttpError(401, 'Invalid staff access token.');
  const actual = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [left, right] = await Promise.all([hash(actual), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  if (difference !== 0) throw new HttpError(401, 'Invalid staff access token.');
}
