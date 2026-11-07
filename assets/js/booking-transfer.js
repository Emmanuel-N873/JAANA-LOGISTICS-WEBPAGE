// Bridges the calculator and booking form using temporary sessionStorage drafts.
// Exposes window.JaanaBooking; booking.js submits the request.
(() => {
  'use strict';
  const shipmentDraftKey = 'jaana.shipmentDraft.v1';
  const dialog = document.getElementById('booking-dialog');
  const form = dialog.querySelector('form');
  const shipmentFieldNames = ['pickup', 'destination', 'packages', 'weight', 'size'];
  const bookingDraftKey = 'jaana.bookingDetailsDraft.v1';
  const attemptStorageKey = 'jaana.pendingBookingAttempt.v1';
  let pendingAttempt = null;
  const canonicalFields = [
    'name',
    'phone',
    'service',
    'date',
    'recipient',
    'recipientPhone',
    'size',
    'pickup',
    'destination',
    'package',
  ];
  // Explicit allowlist: never persist credentials, payment fields or arbitrary form inputs.
  const bookingDetailFields = [
    'service',
    'date',
    'recipient',
    'recipientPhone',
    'name',
    'phone',
    'package',
  ];

  let locationTokens = {
    pickupToken: null,
    destinationToken: null,
  };
  // Real booking fields determine the request identity. Price text and expiring tokens do not.
  // The backend independently validates these values; this hash only preserves browser retries.
  window.JaanaBooking = {
    async prepareAttempt(data) {
      const canonical = {};
      for (const name of canonicalFields) canonical[name] = String(data[name] ?? '').trim();
      for (const name of ['packages', 'weight', 'length', 'width', 'height'])
        if (data[name] !== undefined && data[name] !== '') canonical[name] = Number(data[name]);
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(canonical))
      );
      const fingerprint = [...new Uint8Array(bytes)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      if (!pendingAttempt) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(attemptStorageKey) || 'null');
          if (
            saved &&
            /^[a-f0-9]{64}$/.test(saved.fingerprint) &&
            /^[a-f0-9-]{36}$/.test(saved.key)
          )
            pendingAttempt = saved;
        } catch {
          // Storage may be disabled or an older draft may be malformed. Keep the in-memory fallback.
        }
      }
      if (!pendingAttempt || pendingAttempt.fingerprint !== fingerprint)
        pendingAttempt = { fingerprint, key: crypto.randomUUID() };
      // Save only booking fields on the existing allowlist, never arbitrary form fields.
      try {
        sessionStorage.setItem(attemptStorageKey, JSON.stringify(pendingAttempt));
        sessionStorage.setItem(
          bookingDraftKey,
          JSON.stringify(
            Object.fromEntries(bookingDetailFields.map((name) => [name, String(data[name] ?? '')]))
          )
        );
        const shipmentFields = Object.fromEntries(
          shipmentFieldNames.map((name) => [name, String(data[name] ?? '')])
        );
        sessionStorage.setItem(
          shipmentDraftKey,
          JSON.stringify({
            fields: { ...shipmentFields, ...locationTokens },
            distanceKm: Number(data.distanceKm) || undefined,
            estimateSummary: String(data.estimateSummary || ''),
          })
        );
      } catch {
        /* The in-memory key still protects retries in this page when storage is blocked. */
      }
      return { ...pendingAttempt };
    },
    applyShipment(shipment) {
      if (!shipment) return { changed: false };
      const previous = form.elements.estimateSummary.value;
      const summary = window.JaanaDelivery.formatEstimate(shipment);
      form.elements.distanceKm.value = Number.isFinite(shipment.distanceKm)
        ? String(shipment.distanceKm)
        : '';
      form.elements.estimateSummary.value = summary;
      renderShipmentSummary(shipment);
      return { changed: !!previous.trim() && previous !== summary };
    },
  };
  function restoreBookingDetails() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(bookingDraftKey) || 'null');
      for (const name of bookingDetailFields) {
        if (typeof saved?.[name] === 'string' && saved[name].length <= 500)
          form.elements[name].value = saved[name];
      }
    } catch {
      /* The current form remains usable if storage is unavailable. */
    }
  }
  function clearBookingDrafts() {
    for (const storageKey of [shipmentDraftKey, bookingDraftKey, attemptStorageKey]) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Clearing storage is best effort. */
      }
    }
  }
  window.addEventListener('jaana-booking-saved', clearBookingDrafts);
  const transferredFields = [...shipmentFieldNames, 'distanceKm', 'estimateSummary'];

  function renderShipmentSummary(shipment) {
    const money = window.JaanaDelivery.formatMoney;
    const weightCharge = document.getElementById('booking-weight-charge');
    const totalAmount = document.getElementById('booking-total-amount');
    if (weightCharge)
      weightCharge.textContent =
        shipment?.weightCharge === null
          ? 'Custom quote'
          : Number.isFinite(shipment?.weightCharge)
            ? money(shipment.weightCharge)
            : '—';
    if (totalAmount)
      totalAmount.textContent =
        shipment?.total === null
          ? 'Custom quote'
          : Number.isFinite(shipment?.total)
            ? money(shipment.total)
            : '—';
  }

  window.jaanaBookingLocationTokens = () => ({ ...locationTokens });
  let locked = false,
    originalSize = null;
  function readDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(shipmentDraftKey) || 'null');
    } catch {
      return null;
    }
  }
  function setLocked(value) {
    locked = value;
    // A readonly input keeps package size in FormData; disabled selects are omitted.
    if (value && form.elements.size.tagName === 'SELECT') {
      originalSize = form.elements.size;
      const display = document.createElement('input');
      display.name = 'size';
      display.type = 'text';
      display.value = originalSize.value;
      display.required = true;
      originalSize.replaceWith(display);
    } else if (!value && originalSize) {
      form.elements.size.replaceWith(originalSize);
      originalSize = null;
    }
    for (const name of transferredFields) {
      const field = form.elements[name];
      field.readOnly = value || ['distanceKm', 'estimateSummary'].includes(name);
      field.toggleAttribute('data-calculator-locked', value);
      if (value) field.setAttribute('aria-describedby', 'booking-shipment-help');
      else field.removeAttribute('aria-describedby');
    }
  }
  function openBooking() {
    if (location.hash !== '#booking') return;
    restoreBookingDetails();
    const draft = readDraft();
    if (draft?.fields) {
      locationTokens = {
        pickupToken: typeof draft.fields.pickupToken === 'string' ? draft.fields.pickupToken : null,
        destinationToken:
          typeof draft.fields.destinationToken === 'string' ? draft.fields.destinationToken : null,
      };
      for (const name of shipmentFieldNames) {
        const value = draft.fields[name];
        if (typeof value === 'string' && value.length <= 500) form.elements[name].value = value;
      }
      if (Number.isFinite(draft.distanceKm) && draft.distanceKm > 0)
        form.elements.distanceKm.value = draft.distanceKm;
      if (typeof draft.estimateSummary === 'string')
        form.elements.estimateSummary.value = draft.estimateSummary.slice(0, 1000);
      renderShipmentSummary(draft);
      setLocked(true);
    }
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('dialog-open');
  }
  function saveForCalculator() {
    try {
      sessionStorage.setItem(
        bookingDraftKey,
        JSON.stringify(
          Object.fromEntries(bookingDetailFields.map((name) => [name, form.elements[name].value]))
        )
      );
      sessionStorage.setItem(
        shipmentDraftKey,
        JSON.stringify({
          fields: Object.fromEntries(
            shipmentFieldNames.map((name) => [name, form.elements[name].value])
          ),
        })
      );
      return true;
    } catch {
      document.getElementById('booking-feedback').textContent =
        'Enable session storage to carry your shipment details to the calculator.';
      return false;
    }
  }
  function offerAdjustment() {
    if (
      window.confirm(
        'These shipment details came from the delivery calculator and cannot be edited here. Would you like to return to the delivery calculator to make adjustments?'
      ) &&
      saveForCalculator()
    )
      window.location.href = 'calculator.html';
  }
  form.addEventListener('click', (event) => {
    if (locked && event.target.matches('[data-calculator-locked]')) offerAdjustment();
  });
  form.addEventListener('keydown', (event) => {
    if (
      !locked ||
      !event.target.matches('[data-calculator-locked]') ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (
      event.key === 'Enter' ||
      event.key === 'Backspace' ||
      event.key === 'Delete' ||
      event.key.length === 1
    ) {
      event.preventDefault();
      offerAdjustment();
    }
  });
  openBooking();
  window.addEventListener('hashchange', openBooking);
  form.addEventListener('input', (event) => {
    if (!locked && shipmentFieldNames.includes(event.target.name)) {
      locationTokens = {
        pickupToken: null,
        destinationToken: null,
      };

      form.elements.distanceKm.value = '';
      form.elements.estimateSummary.value =
        'Shipment changed. Recalculate for an updated estimate.';
    }
  });
  document.getElementById('booking-recalculate').addEventListener('click', (event) => {
    if (!saveForCalculator()) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    if (location.hash === '#booking')
      history.replaceState(null, '', location.pathname + location.search);
  });
  document.getElementById('new-booking-request').addEventListener('click', () => {
    pendingAttempt = null;
    setLocked(false);
    locationTokens = {
      pickupToken: null,
      destinationToken: null,
    };
    clearBookingDrafts();
  });
})();
