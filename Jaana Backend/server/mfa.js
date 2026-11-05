import { HttpError, hash } from './common.js';
const encoder = new TextEncoder(),
  decoder = new TextDecoder(),
  alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(20))) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  return result;
}
function decodeSecret(secret) {
  let bits = 0,
    value = 0,
    result = [];
  for (const char of secret) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((value >>> bits) & 255);
    }
  }
  return new Uint8Array(result);
}
async function encryptionKey(env) {
  if (typeof env.MFA_ENCRYPTION_KEY !== 'string' || env.MFA_ENCRYPTION_KEY.length < 32)
    throw new HttpError(503, 'Authenticator setup is not configured. Contact your administrator.');
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encoder.encode(env.MFA_ENCRYPTION_KEY)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}
export async function sealSecret(env, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(env),
    encoder.encode(secret)
  );
  return JSON.stringify({ iv: [...iv], data: [...new Uint8Array(encrypted)] });
}
async function openSecret(env, sealed) {
  const { iv, data } = JSON.parse(sealed);
  return decoder.decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      await encryptionKey(env),
      new Uint8Array(data)
    )
  );
}
export async function totp(secret, counter) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey(
    'raw',
    decodeSecret(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const offset = mac[19] & 15;
  const binary =
    ((mac[offset] & 127) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
}
export async function matchingCounter(env, sealed, code, last = -1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const secret = await openSecret(env, sealed),
    current = Math.floor(Date.now() / 30000);
  for (const counter of [current, current - 1, current + 1])
    if (counter > last && (await totp(secret, counter)) === code) return counter;
  return null;
}
export async function verifySecondFactor(context, user, code) {
  const counter = await matchingCounter(context.env, user.mfa_secret, code, user.mfa_counter);
  let statement;
  if (counter !== null)
    statement = context.env.DB.prepare(
      'UPDATE staff_users SET mfa_counter=? WHERE id=? AND version=? AND mfa_counter<?'
    ).bind(counter, user.id, user.version, counter);
  else if (typeof code === 'string' && /^[a-f0-9]{24}$/i.test(code.replaceAll('-', '')))
    statement = context.env.DB.prepare(
      'DELETE FROM staff_recovery_codes WHERE staff_id=? AND code_hash=?'
    ).bind(user.id, await hash(code.replaceAll('-', '').toLowerCase()));
  else throw new HttpError(401, 'Enter a valid authenticator code or unused recovery code.');
  const result = await context.env.DB.batch([statement]);
  if (!result[0].meta.changes)
    throw new HttpError(401, 'This code has expired or was already used.');
}
export async function recoveryCodes(context, actor, generation) {
  const codes = Array.from({ length: 8 }, () =>
    [...crypto.getRandomValues(new Uint8Array(12))]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
  const statements = [
    context.env.DB.prepare(
      'DELETE FROM staff_recovery_codes WHERE staff_id=? AND EXISTS(SELECT 1 FROM staff_users WHERE id=? AND mfa_generation=?)'
    ).bind(actor.id, actor.id, generation),
  ];
  for (const code of codes)
    statements.push(
      context.env.DB.prepare(
        'INSERT INTO staff_recovery_codes(staff_id,code_hash) SELECT ?,? WHERE EXISTS(SELECT 1 FROM staff_users WHERE id=? AND mfa_generation=?)'
      ).bind(actor.id, await hash(code), actor.id, generation)
    );
  return { codes, statements };
}
