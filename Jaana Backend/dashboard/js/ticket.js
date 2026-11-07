(() => {
  'use strict';

  const message = document.getElementById('ticket-message');
  const ticket = document.getElementById('delivery-ticket');
  const byId = (id) => document.getElementById(id);
  const referencePattern = /^(?:\d{10}|JAANA-\d{8}(?:-[A-F0-9]{6}){4})$/;
  const money = (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? new Intl.NumberFormat('en-NG', {
          style: 'currency',
          currency: 'NGN',
          maximumFractionDigits: 0,
        }).format(value)
      : 'Not quoted';
  const date = (value, includeTime = false) =>
    new Date(value + (value.length === 10 ? 'T12:00:00Z' : '')).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      ...(includeTime ? { timeStyle: 'short' } : {}),
    }) + (includeTime ? ' WAT' : '');
  const set = (id, value) => {
    byId(id).textContent = value || 'Not supplied';
  };

  async function load() {
    const reference = new URLSearchParams(location.search).get('reference')?.trim().toUpperCase();
    if (!referencePattern.test(reference || '')) {
      message.textContent = 'A valid completed booking reference is required.';
      return;
    }
    try {
      const response = await fetch('/api/admin/ticket?reference=' + encodeURIComponent(reference), {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || 'The delivery ticket could not be loaded.');
        error.status = response.status;
        throw error;
      }

      const data = result.ticket;
      const shipment = data.shipment || {};
      const trackingUrl = `${location.origin}/index.html?reference=${encodeURIComponent(data.reference)}#tracking`;
      set('ticket-service', data.service);
      set('ticket-area', data.deliveryAddress.split(',').slice(-2).join(',').trim());
      set('ticket-created', date(data.createdAt, true));
      set('ticket-completed', date(data.completedAt, true));
      set('ticket-reference', data.reference);
      set('ticket-sender', data.sender.name);
      set('ticket-sender-phone', data.sender.phone);
      set('ticket-pickup', data.pickupAddress);
      set('ticket-recipient', data.recipient.name);
      set('ticket-recipient-phone', data.recipient.phone);
      set('ticket-delivery', data.deliveryAddress);
      set('ticket-delivered-by', data.deliveredBy);
      set('ticket-completed-short', date(data.completedAt));
      set('ticket-package', `${data.packageSize}: ${data.packageDetails}`);
      set('ticket-packages', shipment.packages ? String(shipment.packages) : 'Not supplied');
      set('ticket-weight', shipment.weight ? `${shipment.weight} kg` : 'Not supplied');
      set('ticket-charge', money(shipment.distanceCharge));
      set('ticket-total', shipment.total === null ? 'Custom quote' : money(shipment.total));
      set('ticket-remarks', 'Delivery completed. Keep this ticket with your delivery records.');

      // Generate both codes locally so Wrangler/offline staff sessions do not depend on
      // a third-party image host, and so CSP can keep image-src same-origin/data only.
      const barcode = byId('ticket-barcode');
      JsBarcode(barcode, data.reference, {
        format: 'CODE128',
        width: 2,
        height: 80,
        margin: 8,
        displayValue: false,
        xmlDocument: document,
      });
      const qr = qrcode(0, 'M');
      qr.addData(trackingUrl);
      qr.make();
      // Use a generous module size and quiet zone so the printed 23 mm code
      // stays decodable after PDF rasterization and printer downsampling.
      byId('ticket-qr').src = qr.createDataURL(10, 8);
      ticket.hidden = false;
      message.hidden = true;
    } catch (error) {
      message.textContent =
        error.status === 401
          ? 'Your staff session has expired. Return to the dashboard and sign in again.'
          : error.name === 'TimeoutError'
            ? 'The ticket service took too long to respond.'
            : error.message;
    }
  }

  async function preparePrint(action, messageText) {
    const reference = new URLSearchParams(location.search).get('reference')?.trim().toUpperCase();
    const button =
      action === 'ticket.pdf_export_requested' ? byId('pdf-ticket') : byId('print-ticket');
    if (button.disabled || !referencePattern.test(reference || '')) return;
    button.disabled = true;
    message.hidden = false;
    message.textContent = 'Recording your request...';
    try {
      const response = await fetch('/api/admin/ticket-events', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, action }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || 'The ticket action could not be recorded.');
        error.status = response.status;
        throw error;
      }
      message.textContent = messageText;
      window.print();
    } catch (error) {
      message.textContent =
        error.status === 401
          ? 'Your staff session has expired. Return to the dashboard and sign in again.'
          : error.name === 'TimeoutError'
            ? 'The audit service took too long to respond. Nothing was printed.'
            : error.message;
    } finally {
      button.disabled = false;
    }
  }

  byId('print-ticket').addEventListener('click', () =>
    preparePrint('ticket.print_requested', 'Print request recorded. Choose a printer to continue.')
  );
  byId('pdf-ticket').addEventListener('click', () =>
    preparePrint(
      'ticket.pdf_export_requested',
      'PDF export request recorded. Choose “Save as PDF” in the print dialog.'
    )
  );
  load();
})();
