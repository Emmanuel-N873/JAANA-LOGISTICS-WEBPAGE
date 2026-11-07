// Calculator-only behavior: address selection, estimates, and booking handoff.
// See docs/FRONTEND-GUIDE.md for the request sequence and script contracts.
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const form = byId('rate-form');
  const money = window.JaanaDelivery.formatMoney;
  const locationErrorMessage = (data, fallback) => {
    switch (data?.code) {
      case 'invalid_search_query':
        return 'Enter at least 3 characters to search for an address.';
      case 'accuracy_rejected':
        return 'Your location is too inaccurate. Please search for the address instead.';
      case 'invalid_coordinates':
        return 'Your browser returned an invalid location. Please search for the address instead.';
      case 'provider_not_configured':
        return 'Address search is not configured. Please contact JAANA Delivery Service Ltd.';
      case 'provider_rate_limited':
      case 'local_rate_limited':
        return 'Address search is temporarily rate limited. Please retry shortly.';
      case 'provider_authentication':
      case 'provider_rejected':
      case 'provider_timeout':
      case 'provider_unavailable':
      case 'provider_invalid_response':
        return 'Address provider is temporarily unavailable. Please retry shortly.';
      default:
        return data?.error || fallback;
    }
  };
  let quote = null;
  // Incrementing this counter makes older estimate responses harmless after an edit.
  let version = 0;
  const selectedLocations = {
    pickup: null,
    destination: null,
  };
  function setupAddressAutocomplete(name) {
    const input = form.elements[name];
    const list = byId(name === 'pickup' ? 'pickup-suggestions' : 'destination-suggestions');
    const locationButton = byId(
      name === 'pickup' ? 'pickup-location-button' : 'destination-location-button'
    );
    const locationStatus = byId(
      name === 'pickup' ? 'pickup-location-status' : 'destination-location-status'
    );

    let searchTimer;
    let controller;
    let activeIndex = -1;
    let suggestions = [];
    let generation = 0;
    let blurTimer;
    let locationRequest = 0;

    function showLocationStatus(message) {
      locationStatus.textContent = message;
    }

    function close() {
      list.hidden = true;
      list.replaceChildren();
      suggestions = [];
      activeIndex = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function selectSuggestion(index) {
      const suggestion = suggestions[index];

      if (!suggestion || typeof suggestion.token !== 'string') {
        return;
      }

      clearTimeout(searchTimer);
      clearTimeout(blurTimer);
      generation++;
      controller?.abort();

      // Display the selected address.
      input.value = suggestion.label;

      // Save its authenticated location reference.
      selectedLocations[name] = {
        label: suggestion.label,
        token: suggestion.token,
      };

      close();

      // Clear any previous estimate without triggering
      // another autocomplete search.
      invalidate();
      showLocationStatus('Address selected. Confirm it before calculating.');
      byId('rate-feedback').textContent =
        'Address selected. Select the other address, then calculate your estimate.';
    }

    async function useCurrentLocation() {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        showLocationStatus(
          'This browser does not provide location access. Search for the address instead.'
        );
        return;
      }

      const request = ++locationRequest;
      generation++;
      clearTimeout(searchTimer);
      controller?.abort();
      close();
      locationButton.disabled = true;
      showLocationStatus('Requesting your location permission...');

      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
          });
        });
        if (request !== locationRequest) return;

        const { latitude, longitude, accuracy } = position.coords;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          throw new Error(
            'Your browser returned an invalid location. Please search for the address instead.'
          );
        }

        showLocationStatus('Location found. Converting it into an address...');
        const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
        if (Number.isFinite(accuracy)) params.set('accuracy', String(accuracy));
        const response = await fetch('/api/locations?' + params, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            locationErrorMessage(data, 'We could not find an address for your location.')
          );
        if (request !== locationRequest) return;

        const location = data.location;
        if (!location || typeof location.label !== 'string' || typeof location.token !== 'string')
          throw new Error(
            'We could not turn your location into an address. Please search instead.'
          );

        input.value = location.label;
        selectedLocations[name] = { label: location.label, token: location.token };
        invalidate();
        showLocationStatus('Location found. Confirm this address before calculating.');
        byId('rate-feedback').textContent =
          'Your current location was added. Confirm both addresses, then calculate your estimate.';
      } catch (error) {
        if (request !== locationRequest) return;
        const message =
          error?.code === 1
            ? 'Location permission was denied. Search for the address instead.'
            : error?.code === 2
              ? 'Your location could not be determined. Try again or search for the address.'
              : error?.code === 3
                ? 'Location lookup timed out. Try again or search for the address.'
                : error.message || 'Location lookup failed. Search for the address instead.';
        showLocationStatus(message);
      } finally {
        if (request === locationRequest) locationButton.disabled = false;
      }
    }

    function highlight(index) {
      const buttons = [...list.querySelectorAll('button')];
      if (!buttons.length) return;

      activeIndex = (index + buttons.length) % buttons.length;

      buttons.forEach((button, i) => {
        button.setAttribute('aria-selected', String(i === activeIndex));
      });

      const active = buttons[activeIndex];
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', () => {
      selectedLocations[name] = null;
      locationRequest++;
      generation++;
      clearTimeout(blurTimer);

      clearTimeout(searchTimer);
      controller?.abort();
      close();

      const query = input.value.trim();
      if (query.length < 3) return;
      if (query.length > 150) {
        byId('rate-feedback').textContent = 'Use an address search of at most 150 characters.';
        return;
      }
      const searchVersion = generation;

      searchTimer = setTimeout(async () => {
        controller = new AbortController();
        const requestController = controller;

        try {
          const response = await fetch('/api/locations?q=' + encodeURIComponent(query), {
            signal: requestController.signal,
          });

          const data = await response.json();
          if (!response.ok)
            throw new Error(
              locationErrorMessage(data, 'Address suggestions are unavailable. Please retry.')
            );

          // Ignore responses for an address that has since changed.
          if (
            searchVersion !== generation ||
            document.activeElement !== input ||
            requestController.signal.aborted ||
            input.value.trim() !== query
          )
            return;

          suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 5) : [];

          list.replaceChildren();

          suggestions.forEach((suggestion, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = `${name}-suggestion-${index}`;
            button.className = 'address-suggestion';
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', 'false');
            button.textContent = suggestion.label;

            button.addEventListener('pointerdown', (event) => {
              event.preventDefault();
            });

            button.addEventListener('click', () => {
              selectSuggestion(index);
            });

            list.appendChild(button);
          });

          list.hidden = suggestions.length === 0;
          if (!suggestions.length)
            byId('rate-feedback').textContent =
              'No matching addresses found. Try a street, landmark, area and city.';
          input.setAttribute('aria-expanded', String(suggestions.length > 0));
        } catch (error) {
          if (
            error.name !== 'AbortError' &&
            searchVersion === generation &&
            document.activeElement === input
          ) {
            close();
            byId('rate-feedback').textContent =
              error.message || 'Address suggestions are unavailable. Please retry.';
          }
        }
      }, 400);
    });

    input.addEventListener('keydown', (event) => {
      if (list.hidden || !suggestions.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlight(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlight(activeIndex - 1);
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        selectSuggestion(activeIndex);
      } else if (event.key === 'Escape') {
        clearTimeout(searchTimer);
        controller?.abort();
        generation++;
        close();
      }
    });

    input.addEventListener('blur', () => {
      clearTimeout(searchTimer);
      controller?.abort();
      generation++;
      blurTimer = setTimeout(close, 150);
    });

    locationButton.addEventListener('click', useCurrentLocation);

    form.addEventListener('reset', () => {
      selectedLocations[name] = null;
      locationRequest++;
      generation++;
      clearTimeout(blurTimer);
      clearTimeout(searchTimer);
      controller?.abort();
      close();
      showLocationStatus('');
    });
  }
  function updateCustomQuotation() {
    const weight = form.elements.weight.valueAsNumber;
    byId('custom-quotation').hidden = !(Number.isFinite(weight) && weight > 20);
  }
  const payload = () => ({
    ...Object.fromEntries(new FormData(form)),
    pickupToken: selectedLocations.pickup?.token ?? null,
    destinationToken: selectedLocations.destination?.token ?? null,
  });
  const formatEstimate = window.JaanaDelivery.formatEstimate;
  function renderPricingRates(pricingRates) {
    document
      .querySelectorAll('[data-per-km]')
      .forEach((e) => (e.textContent = money(pricingRates.perKm)));
    document
      .querySelectorAll('[data-minimum]')
      .forEach((e) => (e.textContent = money(pricingRates.minimum)));
    byId('rate-formula').textContent =
      `Total = higher of ${money(pricingRates.minimum)} or (road distance × ${money(pricingRates.perKm)}), plus weight charge.`;
  }
  renderPricingRates({ perKm: 300, minimum: 2000 });
  fetch('/api/pricing', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw Error();
      renderPricingRates(await response.json());
    })
    .catch(() => {
      byId('rate-feedback').textContent =
        'Displayed rates are defaults. Current pricing will be checked when you calculate.';
    });
  function invalidate() {
    byId('rate-contact').href = 'https://wa.me/2348038422591';
    version++;
    quote = null;
    byId('continue-booking').disabled = true;
    for (const id of ['road-distance', 'distance-charge', 'weight-charge', 'rate-total'])
      byId(id).textContent = '—';
    byId('minimum-row').hidden = true;
    byId('route-map').hidden = true;
  }
  async function calculate() {
    if (!form.reportValidity()) return;
    if (!selectedLocations.pickup?.token || !selectedLocations.destination?.token) {
      byId('rate-feedback').textContent =
        'Please select both addresses from the suggestions before calculating.';
      return;
    }
    const current = ++version;
    quote = null;
    byId('continue-booking').disabled = true;
    byId('rate-feedback').textContent = 'Finding your road route and current pricing...';
    try {
      const response = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
        signal: AbortSignal.timeout(15000),
      });
      const estimateResult = await response.json();
      if (current !== version) return;
      if (!response.ok) throw Error(estimateResult.error || 'Could not calculate this route.');
      quote = estimateResult;
      renderPricingRates(estimateResult.rates);
      byId('road-distance').textContent = estimateResult.distanceKm.toFixed(3) + ' km';
      byId('distance-charge').textContent = money(estimateResult.distanceCharge);
      byId('distance-label').textContent =
        `Distance charge × ${money(estimateResult.rates.perKm)}/km`;
      byId('weight-charge').textContent =
        estimateResult.weightCharge === null ? 'Custom quote' : money(estimateResult.weightCharge);
      byId('minimum-row').hidden = !estimateResult.minimumApplied;
      byId('rate-total').textContent =
        estimateResult.total === null ? 'Custom quote' : money(estimateResult.total);
      const data = payload();
      byId('route-map').href =
        'https://www.google.com/maps/dir/?api=1&origin=' +
        encodeURIComponent(data.pickup) +
        '&destination=' +
        encodeURIComponent(data.destination) +
        '&travelmode=driving';
      byId('route-map').hidden = false;
      byId('rate-contact').href =
        'https://wa.me/2348038422591?text=' +
        encodeURIComponent(
          'Hello JAANA Delivery Service Ltd, please quote for my shipment.\n' +
            Object.entries(data)
              .filter(([key]) => !['pickupToken', 'destinationToken'].includes(key))
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n') +
            '\n' +
            formatEstimate(estimateResult)
        );
      byId('continue-booking').disabled = false;
      byId('rate-feedback').textContent =
        estimateResult.total === null
          ? 'Your shipment needs a custom quotation. Continue to record your details or contact us on WhatsApp.'
          : 'Route calculated. Check the route on Google Maps, then continue to booking.';
    } catch (e) {
      if (current === version)
        byId('rate-feedback').textContent =
          e.name === 'TimeoutError' ? 'Map request timed out. Please retry.' : e.message;
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    calculate();
  });
  form.addEventListener('input', () => {
    updateCustomQuotation();
    invalidate();

    byId('rate-feedback').textContent =
      'Select your pickup and delivery addresses, then click Calculate Estimate.';
  });
  form.addEventListener('reset', () => {
    byId('custom-quotation').hidden = true;
    invalidate();
    byId('rate-feedback').textContent = '';
    byId('rate-contact').href = 'https://wa.me/2348038422591';
  });
  byId('continue-booking').addEventListener('click', () => {
    if (!quote) return;
    try {
      sessionStorage.setItem(
        'jaana.shipmentDraft.v1',
        JSON.stringify({
          fields: payload(),
          distanceKm: quote.distanceKm,
          weightCharge: quote.weightCharge,
          total: quote.total,
          estimateSummary: formatEstimate(quote),
        })
      );
      window.location.href = 'index.html#booking';
    } catch {
      byId('rate-feedback').textContent =
        'Please enable session storage in your browser to carry shipment details to booking.';
    }
  });
  try {
    const draft = JSON.parse(sessionStorage.getItem('jaana.shipmentDraft.v1') || 'null');
    if (draft?.fields)
      for (const [name, value] of Object.entries(draft.fields))
        if (form.elements[name]) form.elements[name].value = value;
  } catch {}
  byId('rate-contact').addEventListener('click', () => {
    const data = payload();
    const lines = Object.entries(data)
      .filter(([name]) => !['pickupToken', 'destinationToken'].includes(name))
      .map(([name, value]) => name + ': ' + value);
    byId('rate-contact').href =
      'https://wa.me/2348038422591?text=' +
      encodeURIComponent(
        'Hello JAANA Delivery Service Ltd, please quote for my shipment.\n' +
          lines.join('\n') +
          (quote ? '\n' + formatEstimate(quote) : '')
      );
  });
  setupAddressAutocomplete('pickup');
  setupAddressAutocomplete('destination');
  updateCustomQuotation();
})();
