import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const transfer = readFileSync(
  new URL('../../assets/js/booking-transfer.js', import.meta.url),
  'utf8'
);
const bookingCode = readFileSync(new URL('../../assets/js/booking.js', import.meta.url), 'utf8');
const pricePresentation = readFileSync(
  new URL('../../assets/js/delivery-summary.js', import.meta.url),
  'utf8'
);
function page(
  storage = new Map(),
  send = async () => ({ reference: 'JAANA-20261023-AAAAAA-BBBBBB-CCCCCC-DDDDDD' })
) {
  class Element {
    constructor() {
      this.value = '';
      this.tagName = 'INPUT';
      this.type = 'text';
      this.required = false;
      this.disabled = false;
      this.hidden = false;
      this.events = {};
      this.dataset = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.attrs = {};
      this.innerHTML = 'Save Booking Request';
    }
    addEventListener(name, fn) {
      (this.events[name] ??= []).push(fn);
    }
    async fire(name, event = {}) {
      for (const fn of this.events[name] || [])
        await fn({ target: this, preventDefault() {}, ...event });
    }
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
    removeAttribute(name) {
      delete this.attrs[name];
    }
    toggleAttribute(name, value) {
      if (value) this.attrs[name] = '';
      else delete this.attrs[name];
    }
    setCustomValidity(value) {
      this.validation = value;
    }
    focus() {}
    scrollIntoView() {}
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.fire('close');
    }
    replaceWith() {}
    querySelectorAll() {
      return [];
    }
    getBoundingClientRect() {
      return { left: 0, right: 100, top: 0, bottom: 100 };
    }
  }
  const nodes = new Map(),
    get = (id) => {
      if (!nodes.has(id)) nodes.set(id, new Element());
      return nodes.get(id);
    };
  const names = [
    'service',
    'date',
    'recipient',
    'recipientPhone',
    'size',
    'name',
    'phone',
    'pickup',
    'destination',
    'package',
    'packages',
    'weight',
    'distanceKm',
    'estimateSummary',
  ];
  const form = new Element();
  form.elements = Object.fromEntries(names.map((name) => [name, new Element()]));
  form.elements.namedItem = (name) => form.elements[name];
  form.dataset.request = 'Delivery booking';
  form.closest = () => ({ id: 'booking-dialog' });
  form.querySelector = () => get('submit');
  form.querySelectorAll = () => names.map((name) => form.elements[name]);
  form.reportValidity = () => !names.some((name) => form.elements[name].validation);
  form.reset = () => {
    for (const name of names) form.elements[name].value = '';
  };
  const tracking = new Element();
  get('booking-dialog').querySelector = () => form;
  const windowEvents = {};
  const window = {
    location: { href: '' },
    JaanaBooking: null,
    addEventListener(name, fn) {
      (windowEvents[name] ??= []).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of windowEvents[event.type] || []) fn(event);
    },
    confirm: () => true,
  };
  const storageApi = {
    getItem: (name) => storage.get(name) || null,
    setItem: (name, value) => storage.set(name, value),
    removeItem: (name) => storage.delete(name),
  };
  const document = {
    getElementById: get,
    body: { classList: { add() {}, remove() {} } },
    addEventListener() {},
    querySelector(selector) {
      if (selector === '.menu-toggle') return get('menu');
      if (selector === '#main-nav') return get('nav');
      if (selector === '#booking-dialog form') return form;
      if (selector.includes('[name="reference"]')) return tracking;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'form[data-request]') return [form];
      if (selector === 'input[type="date"]') return [form.elements.date];
      return [];
    },
  };
  const context = {
    window,
    document,
    sessionStorage: storageApi,
    localStorage: storageApi,
    location: { hash: '#booking', pathname: '/index.html', search: '' },
    history: { replaceState() {} },
    crypto,
    TextEncoder,
    Intl,
    Date,
    Event,
    AbortSignal,
    navigator: {},
    FormData: class {
      constructor(target) {
        return {
          entries: () =>
            names
              .filter((name) => !target.elements[name].disabled)
              .map((name) => [name, target.elements[name].value]),
        };
      }
    },
    fetch: async (url, options) => ({
      ok: true,
      json: async () => send(JSON.parse(options.body), options.headers),
    }),
    console,
  };
  vm.runInNewContext(pricePresentation, context);
  vm.runInNewContext(transfer, context);
  vm.runInNewContext(bookingCode, context);
  function fill() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 2);
    if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
    const values = {
      name: 'Customer',
      phone: '08000000000',
      recipient: 'Recipient',
      recipientPhone: '08000000001',
      service: 'Document Delivery',
      size: 'Envelope or document',
      pickup: 'Pickup',
      destination: 'Delivery',
      package: 'Documents',
      date: date.toISOString().slice(0, 10),
      packages: '1',
      weight: '8',
      distanceKm: '12',
      estimateSummary: 'Earlier estimate',
    };
    for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
    return values;
  }
  return { form, get, storage, window, fill, submit: () => form.fire('submit') };
}
test('a timed-out booking keeps its idempotency key after navigation and quote/token refresh', async () => {
  const storage = new Map(),
    keys = [];
  let first = page(storage, async (data, headers) => {
    keys.push(headers['Idempotency-Key']);
    throw new TypeError('Response lost');
  });
  first.fill();
  await first.submit();
  assert(storage.has('jaana.pendingBookingAttempt.v1'));
  const draft = JSON.parse(storage.get('jaana.shipmentDraft.v1'));
  draft.estimateSummary = 'Refreshed estimate';
  draft.distanceKm = 12.1;
  draft.fields.pickupToken = 'fresh-proof';
  draft.fields.destinationToken = 'fresh-proof-2';
  storage.set('jaana.shipmentDraft.v1', JSON.stringify(draft));
  const next = page(storage, async (data, headers) => {
    keys.push(headers['Idempotency-Key']);
    return { reference: 'JAANA-20261023-AAAAAA-BBBBBB-CCCCCC-DDDDDD', shipment: null };
  });
  assert.equal(next.form.elements.name.value, 'Customer');
  await next.submit();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert(!storage.has('jaana.pendingBookingAttempt.v1'));
  assert(!storage.has('jaana.bookingDetailsDraft.v1'));
  await next.submit();
  assert.equal(keys[2], keys[0]);
  await next.get('new-booking-request').fire('click');
  next.fill();
  await next.submit();
  assert.notEqual(keys[3], keys[0]);
});
test('saved server prices update the booking fields, customer notice and WhatsApp message', async () => {
  const c = page(new Map(), async () => ({
    reference: 'JAANA-20261023-AAAAAA-BBBBBB-CCCCCC-DDDDDD',
    shipment: {
      distanceKm: 12,
      rates: { perKm: 400, minimum: 2000 },
      distanceCharge: 4800,
      minimumApplied: false,
      weightCharge: 500,
      total: 5300,
    },
  }));
  c.fill();
  c.form.elements.estimateSummary.value = 'Old estimate: 4100';
  await c.submit();
  assert.match(c.form.elements.estimateSummary.value, /5,300/);
  assert.match(c.get('booking-feedback').textContent, /estimate changed/);
  const message = new URL(c.get('booking-whatsapp').href).searchParams.get('text');
  assert.match(message, /5,300/);
  assert(!message.includes('4100'));
  assert(!message.includes('Token'));
});
test('only real booking changes create a new pending request identity', async () => {
  const c = page();
  const data = c.fill();
  const first = await c.window.JaanaBooking.prepareAttempt(data);
  const repriced = await c.window.JaanaBooking.prepareAttempt({
    ...data,
    distanceKm: '99',
    estimateSummary: 'Different price',
    pickupToken: 'replacement',
  });
  assert.equal(first.key, repriced.key);
  const changed = await c.window.JaanaBooking.prepareAttempt({ ...data, weight: '9' });
  assert.notEqual(first.key, changed.key);
  const stored = JSON.parse(c.storage.get('jaana.pendingBookingAttempt.v1'));
  assert.equal(typeof stored.fingerprint, 'string');
  assert(!JSON.stringify(stored).includes('Customer'));
});
