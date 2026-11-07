// Customer booking, delivery-status lookup, and WhatsApp request messages.
// Load delivery-summary.js and booking-transfer.js before this file.
(() => {
  'use strict';
  const labels = {
    name: 'Name',
    phone: 'Phone',
    pickup: 'Pickup',
    destination: 'Delivery location',
    package: 'Package details',
    reference: 'Delivery reference',
    service: 'Service type',
    date: 'Preferred delivery date',
    recipient: 'Recipient name',
    recipientPhone: 'Recipient phone',
    size: 'Approximate package size',
  };
  const lagosToday = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type).value;
    return part('year') + '-' + part('month') + '-' + part('day');
  };
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    const refresh = () => {
      input.min = lagosToday();
    };
    refresh();
    input.addEventListener('focus', refresh);
  });
  const bookingForm = document.querySelector('#booking-dialog form');
  const referencePanel = document.getElementById('booking-reference-panel');
  const referenceInput = document.getElementById('booking-reference');
  const bookingFeedback = document.getElementById('booking-feedback');
  const updateReference = document.querySelector('#tracking-dialog [name="reference"]');
  const referenceStorageKey = 'jaana.latestRequestReference.v1';
  let bookingRequest = null;
  let bookingAttempt = null;
  const urlReference = decodeURIComponent(
    location.search.match(/[?&]reference=([^&]*)/)?.[1] || ''
  );
  if (/^(?:\d{10}|JAANA-\d{8}(?:-[A-F0-9]{6}){4})$/.test(urlReference || ''))
    updateReference.value = urlReference.toUpperCase();
  try {
    const savedReference = localStorage.getItem(referenceStorageKey);
    if (/^(?:\d{10}|JAANA-\d{8}(?:-[A-F0-9]{6}){4})$/.test(savedReference || ''))
      updateReference.value = savedReference;
  } catch {
    /* References still work when browser storage is unavailable. */
  }
  if (location.hash === '#tracking' && updateReference.value) {
    const trackingDialog = document.getElementById('tracking-dialog');
    trackingDialog.showModal();
    document.body.classList.add('dialog-open');
    updateReference.focus();
  }

  const requestApi = async (url, payload, headers = {}) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        'The booking server is unavailable. Run the backend or contact JAANA Delivery Service Ltd on WhatsApp.'
      );
    }
    if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
  };
  document.getElementById('copy-booking-reference').addEventListener('click', async () => {
    if (!bookingRequest) return;
    try {
      await navigator.clipboard.writeText(bookingRequest.reference);
      bookingFeedback.textContent = 'Reference copied. Keep it for your delivery updates.';
    } catch {
      referenceInput.focus();
      referenceInput.select();
      referenceInput.setSelectionRange(0, referenceInput.value.length);
      bookingFeedback.textContent =
        'Your reference is selected. Copy it using your device’s copy command.';
    }
  });
  document.getElementById('use-booking-reference').addEventListener('click', () => {
    if (!bookingRequest) return;
    updateReference.value = bookingRequest.reference;
    updateReference.setCustomValidity('');
    document.getElementById('booking-dialog').close();
    document.getElementById('tracking-dialog').showModal();
    document.body.classList.add('dialog-open');
    updateReference.focus();
  });
  document.getElementById('new-booking-request').addEventListener('click', () => {
    bookingRequest = null;
    bookingAttempt = null;
    bookingForm.reset();
    bookingForm
      .querySelectorAll('input, select, textarea')
      .forEach((field) => field.setCustomValidity(''));
    referencePanel.hidden = true;
    referenceInput.value = '';
    document.getElementById('booking-whatsapp').removeAttribute('href');
    bookingFeedback.textContent =
      'Ready for a new booking. Complete the form to generate a new reference.';
    bookingForm.elements.service.focus();
  });
  document.querySelectorAll('form[data-request]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = [...new FormData(form).entries()];
      for (const [name, value] of fields) {
        const field = form.elements.namedItem(name);
        const trimmed = String(value).trim();
        field.setCustomValidity(field.required && !trimmed ? 'Please enter this information.' : '');
        if (field.type === 'date' && trimmed) {
          field.min = lagosToday();
          if (trimmed < field.min) field.setCustomValidity('Please choose today or a future date.');
          else if (new Date(trimmed + 'T12:00:00Z').getUTCDay() === 0)
            field.setCustomValidity(
              'Please choose Monday to Saturday, when our team is available.'
            );
        }
      }
      if (!form.reportValidity()) return;
      const isBooking = form === bookingForm;
      const isUpdate = form.closest('dialog').id === 'tracking-dialog';
      const feedback = isBooking
        ? bookingFeedback
        : document.getElementById(isUpdate ? 'delivery-status-result' : 'quote-feedback');
      const submit = form.querySelector('[type="submit"]');
      const newBookingButton = document.getElementById('new-booking-request');
      if (submit.disabled) return;
      const originalButtonContent = submit.innerHTML;
      submit.disabled = true;
      if (isBooking) {
        submit.textContent = 'Submitting Booking...';
        submit.setAttribute('aria-busy', 'true');
        newBookingButton.disabled = true;
      }
      const editableFields = isBooking ? [...form.querySelectorAll('input, select, textarea')] : [];
      editableFields.forEach((field) => {
        field.disabled = true;
      });
      try {
        const requestLines = [];
        if (isUpdate) {
          feedback.textContent = 'Checking your delivery status...';
          const result = await requestApi('/api/delivery-status', {
            reference: form.elements.reference.value.trim(),
          });
          feedback.textContent =
            result.label +
            ' - updated ' +
            new Date(result.updatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) +
            ' WAT. Contact JAANA if you need more information.';
          return;
        }
        if (isBooking) {
          bookingAttempt = await window.JaanaBooking.prepareAttempt(Object.fromEntries(fields));
          const fingerprint = bookingAttempt.fingerprint;
          if (!bookingRequest || bookingRequest.fingerprint !== fingerprint)
            referencePanel.hidden = true;
          feedback.textContent = 'Saving your booking request...';
          const bookingData = {
            ...Object.fromEntries(fields),
            ...(window.jaanaBookingLocationTokens?.() || {}),
          };

          const result = await requestApi('/api/bookings', bookingData, {
            'Idempotency-Key': bookingAttempt.key,
          });
          const pricingUpdate = window.JaanaBooking.applyShipment(result.shipment);
          // Build the WhatsApp message from saved pricing, not the calculator's old estimate.
          for (const name of ['distanceKm', 'estimateSummary']) {
            const entry = fields.find(([field]) => field === name);
            if (entry) entry[1] = bookingForm.elements[name].value;
          }
          bookingRequest = {
            fingerprint,
            reference: result.reference,
            priceChanged: pricingUpdate.changed,
          };
          window.dispatchEvent(new Event('jaana-booking-saved'));
          requestLines.push('Booking request reference: ' + bookingRequest.reference, '');
        }
        const message = [
          'Hello JAANA Delivery Service Ltd,',
          form.dataset.request,
          '',
          ...requestLines,
          ...fields.map(([name, value]) => (labels[name] || name) + ': ' + String(value).trim()),
        ].join('\n');
        const whatsappUrl = 'https://wa.me/2348038422591?text=' + encodeURIComponent(message);
        if (isBooking) {
          referenceInput.value = bookingRequest.reference;
          referencePanel.hidden = false;
          updateReference.value = bookingRequest.reference;
          updateReference.setCustomValidity('');
          document.getElementById('booking-whatsapp').href = whatsappUrl;
          try {
            localStorage.setItem(referenceStorageKey, bookingRequest.reference);
          } catch {
            /* Saving is optional. */
          }
          feedback.textContent =
            (bookingRequest.priceChanged
              ? 'The estimate changed during verification. The updated breakdown is shown in your booking details. '
              : '') +
            'Your request is saved. Keep your reference. JAANA will confirm availability and pricing; you can also follow up on WhatsApp.';
          referencePanel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        } else {
          window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        }
      } catch (error) {
        feedback.textContent =
          error.name === 'TimeoutError'
            ? 'The server took too long to respond. Please retry the same request; it will not create a duplicate.'
            : error.name === 'TypeError'
              ? 'Could not reach the booking service. Please retry or contact JAANA Delivery Service Ltd on WhatsApp.'
              : error.message;
      } finally {
        submit.disabled = false;
        if (isBooking) {
          submit.innerHTML = originalButtonContent;
          submit.removeAttribute('aria-busy');
          newBookingButton.disabled = false;
        }
        editableFields.forEach((field) => {
          field.disabled = false;
        });
      }
    });
    form.addEventListener('input', (event) => {
      if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
    });
  });
})();
