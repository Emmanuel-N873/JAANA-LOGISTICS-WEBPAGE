import { HttpError } from './common.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const MAX_AGE_SECONDS = 15 * 60;

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(400, 'Invalid location selection.');
  }

  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');

    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));

    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'Invalid location selection.');
  }
}

async function signingKey(env) {
  const secret = env.LOCATION_SIGNING_SECRET;

  if (typeof secret !== 'string' || secret.length < 32) {
    throw new HttpError(503, 'Secure location selection is temporarily unavailable.');
  }

  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signLocation(env, location) {
  if (
    typeof location.label !== 'string' ||
    !location.label.trim() ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lon) ||
    location.lat < -90 ||
    location.lat > 90 ||
    location.lon < -180 ||
    location.lon > 180
  ) {
    throw new HttpError(400, 'Invalid location details.');
  }

  const payload = {
    label: location.label,
    lat: location.lat,
    lon: location.lon,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };

  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));

  const key = await signingKey(env);

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encoded));

  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyLocation(env, token, expectedLabel) {
  if (typeof token !== 'string' || token.length > 4096) {
    throw new HttpError(400, 'Please select an address from the suggestions.');
  }

  const parts = token.split('.');

  if (parts.length !== 2) {
    throw new HttpError(400, 'Invalid location selection.');
  }

  const [encoded, signature] = parts;
  const key = await signingKey(env);

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    fromBase64Url(signature),
    encoder.encode(encoded)
  );

  if (!valid) {
    throw new HttpError(400, 'Location selection could not be verified.');
  }

  let location;

  try {
    location = JSON.parse(decoder.decode(fromBase64Url(encoded)));
  } catch {
    throw new HttpError(400, 'Invalid location selection.');
  }

  if (
    !location ||
    typeof location.label !== 'string' ||
    location.label !== expectedLabel ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lon) ||
    location.lat < -90 ||
    location.lat > 90 ||
    location.lon < -180 ||
    location.lon > 180 ||
    !Number.isSafeInteger(location.exp) ||
    location.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new HttpError(
      400,
      'Your location selection has expired or changed. Please select the address again.'
    );
  }

  return {
    lat: location.lat,
    lon: location.lon,
  };
}
