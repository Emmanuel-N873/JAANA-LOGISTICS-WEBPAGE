import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('delivery ticket codes are generated locally and remain CSP-safe', () => {
  const html = source('dashboard/ticket.html');
  const script = source('dashboard/js/ticket.js');
  const headers = source('public/_headers');

  assert.match(html, /assets\/js\/qrcode-generator\.js/);
  assert.match(html, /assets\/js\/jsbarcode\.js/);
  assert.match(script, /JsBarcode\(barcode, data\.reference/);
  assert.match(script, /qr\.addData\(trackingUrl\)/);
  assert.doesNotMatch(script, /quickchart\.io|https?:\/\/[^'"`]+(?:barcode|qr)/i);
  assert.match(headers, /img-src 'self' data:/);
  assert.doesNotMatch(headers, /img-src[^\r\n]*quickchart/i);
});
