// Administrator pricing form. The API enforces permissions and validates every saved rate.
// Shared staff events and API contracts: see docs/FRONTEND-GUIDE.md.
(() => {
  const button = document.getElementById('manage-pricing'),
    dialog = document.getElementById('pricing-dialog'),
    form = document.getElementById('pricing-form'),
    message = document.getElementById('pricing-message');
  let sessionVersion = 0;
  window.addEventListener('staff-sessionVersion', (event) => {
    sessionVersion++;
    button.hidden = !(
      event.detail?.role === 'admin' &&
      !event.detail.mustChangePassword &&
      !event.detail.mustEnrollMfa
    );
    if (button.hidden) dialog.close();
  });
  async function api(options = {}) {
    const response = await fetch('/api/pricing', {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Pricing request failed.');
    return data;
  }
  button.addEventListener('click', async () => {
    dialog.showModal();
    message.textContent = 'Loading current rates…';
    form.hidden = true;
    const current = sessionVersion;
    try {
      const rates = await api();
      if (current !== sessionVersion) return;
      form.elements.perKm.value = rates.perKm;
      form.elements.minimum.value = rates.minimum;
      form.hidden = false;
      message.textContent = '';
    } catch (e) {
      message.textContent = e.message;
    }
  });
  document.getElementById('close-pricing').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button');
    submit.disabled = true;
    message.textContent = 'Saving…';
    const current = sessionVersion;
    try {
      await api({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          perKm: Number(form.elements.perKm.value),
          minimum: Number(form.elements.minimum.value),
        }),
      });
      if (current === sessionVersion)
        message.textContent = 'Pricing saved. New estimates will use these rates.';
    } catch (e) {
      if (current === sessionVersion) message.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  });
})();
