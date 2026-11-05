import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const projectFile = (name) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const presentation = projectFile('assets/js/delivery-summary.js');

function scriptPaths(html) {
  return [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].map((match) => match[1]);
}

test('customer pages load the shared formatter before scripts that use it', () => {
  const home = scriptPaths(projectFile('index.html'));
  const calculator = scriptPaths(projectFile('calculator.html'));
  assert.deepEqual(home, [
    'assets/js/delivery-summary.js',
    'assets/js/booking-transfer.js',
    'assets/js/script.js',
    'assets/js/booking.js',
    'assets/js/service-carousel.js',
  ]);
  assert.deepEqual(calculator, ['assets/js/delivery-summary.js', 'assets/js/calculator.js']);
  for (const name of [...home, ...calculator]) assert(projectFile(name).length > 0);
});

test('homepage dialog and accessibility references point to real elements', () => {
  const home = projectFile('index.html');
  const ids = new Set([...home.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  for (const match of home.matchAll(/<button\b[^>]*data-dialog="([^"]+)"[^>]*>/g)) {
    assert(ids.has(match[1]), `Dialog trigger points to missing #${match[1]}`);
    assert.match(match[0], /aria-haspopup="dialog"/, 'Dialog triggers must identify their popup');
  }

  for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
    const pattern = new RegExp(`${attribute}="([^"]+)"`, 'g');
    for (const match of home.matchAll(pattern)) {
      for (const id of match[1].split(/\s+/))
        assert(ids.has(id), `${attribute} points to missing #${id}`);
    }
  }

  for (const match of home.matchAll(/href="#([^"#]+)"/g)) {
    assert(ids.has(match[1]), `Homepage link points to missing #${match[1]}`);
  }
});

test('shared quotation presentation explains minimum charges and custom quotes consistently', () => {
  const context = { window: {}, Intl };
  vm.runInNewContext(presentation, context);
  const format = context.window.JaanaDelivery.formatEstimate;
  const shipment = {
    distanceKm: 12,
    rates: { perKm: 300, minimum: 2000 },
    distanceCharge: 3600,
    minimumApplied: false,
    weightCharge: 500,
    total: 4100,
  };
  assert.equal(
    format(shipment),
    'Road distance: 12.000 km\nDistance: ₦3,600\nWeight charge: ₦500\nEstimated total: ₦4,100'
  );
  assert.match(format({ ...shipment, minimumApplied: true }), /minimum ₦2,000 applied/);
  assert.match(
    format({ ...shipment, weightCharge: null, total: null }),
    /Custom quotation required/
  );
  assert.equal(format(null), 'No automatic estimate was saved. JAANA will confirm pricing.');
});
