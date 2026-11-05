// Pure presentation helper used by the calculator and the saved booking form.
// The server remains responsible for calculating and verifying every price.
(() => {
  'use strict';
  function formatMoney(amount) {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 0,
    }).format(amount);
  }
  function formatEstimate(shipment) {
    if (!shipment || !Number.isFinite(shipment.distanceKm) || !shipment.rates) {
      return 'No automatic estimate was saved. JAANA will confirm pricing.';
    }
    const minimumNote = shipment.minimumApplied
      ? ' (minimum ' + formatMoney(shipment.rates.minimum) + ' applied)'
      : '';
    const weightCharge =
      shipment.weightCharge === null ? 'Custom quotation' : formatMoney(shipment.weightCharge);
    const total =
      shipment.total === null ? 'Custom quotation required' : formatMoney(shipment.total);
    return [
      'Road distance: ' + shipment.distanceKm.toFixed(3) + ' km',
      'Distance: ' + formatMoney(shipment.distanceCharge) + minimumNote,
      'Weight charge: ' + weightCharge,
      'Estimated total: ' + total,
    ].join('\n');
  }
  // This small public contract is documented in docs/FRONTEND-GUIDE.md.
  window.JaanaDelivery = Object.freeze({ formatMoney, formatEstimate });
})();
