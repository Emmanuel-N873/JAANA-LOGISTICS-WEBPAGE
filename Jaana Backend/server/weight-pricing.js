import { HttpError } from './common.js';

// Accept at most three decimal places (1 gram). Parse decimal digits rather than
// multiplying floating-point kilograms, so 6.001 kg always bills two extra kg.
export function weightInGrams(value) {
  const input =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,3})?$/.test(input)) {
    throw new HttpError(400, 'Enter a positive weight with at most 3 decimal places.');
  }
  const [whole, fraction = ''] = input.split('.');
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(grams) || grams <= 0 || grams > 10000000) {
    throw new HttpError(400, 'Enter a weight greater than zero and no more than 10,000 kg.');
  }
  return grams;
}

export function weightPricing(value) {
  const grams = weightInGrams(value);
  const customQuotationRequired = grams > 20000;
  return {
    customQuotationRequired,
    weightCharge: customQuotationRequired
      ? null
      : Math.ceil(Math.max(0, grams - 5000) / 1000) * 500,
  };
}
