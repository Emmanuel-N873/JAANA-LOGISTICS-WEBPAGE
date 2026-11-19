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

test('ticket renders saved weight, surcharge and total without repricing historical shipments', async () => {
  const { default: vm } = await import('node:vm');
  for (const [weightCharge, total] of [
    [1500, 4500],
    [500, 3500],
  ]) {
    const nodes = new Map();
    const get = (id) => {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, addEventListener() {} });
      return nodes.get(id);
    };
    vm.runInNewContext(source('dashboard/js/ticket.js'), {
      document: { getElementById: get },
      location: { search: '?reference=1234567890', origin: 'https://jaana.example' },
      URLSearchParams,
      Intl,
      AbortSignal,
      fetch: async () => ({
        ok: true,
        json: async () => ({
          ticket: {
            reference: '1234567890',
            service: 'Document Delivery',
            deliveryAddress: 'Lekki, Lagos',
            pickupAddress: 'Ikeja, Lagos',
            sender: { name: 'Sender', phone: '08000000000' },
            recipient: { name: 'Recipient', phone: '08000000001' },
            createdAt: '2026-11-01T10:00:00Z',
            completedAt: '2026-11-02T10:00:00Z',
            packageSize: 'Medium',
            packageDetails: 'Documents',
            shipment: { weight: 8, packages: 1, distanceCharge: 3000, weightCharge, total },
          },
        }),
      }),
      JsBarcode() {},
      qrcode: () => ({
        addData() {},
        make() {},
        createDataURL() {
          return 'data:image/gif;base64,';
        },
      }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(get('ticket-weight').textContent, '8 kg');
    assert.equal(
      get('ticket-weight-charge').textContent,
      new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        maximumFractionDigits: 0,
      }).format(weightCharge)
    );
    assert.equal(
      get('ticket-total').textContent,
      new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        maximumFractionDigits: 0,
      }).format(total)
    );
    assert.equal(get('delivery-ticket').hidden, false);
  }
  assert.match(source('dashboard/ticket.html'), /id="ticket-weight-charge"/);
  assert.match(source('dashboard/css/ticket.css'), /size: A6 portrait/);
});
