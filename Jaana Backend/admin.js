(() => {
  'use strict';
  const login = document.getElementById('staff-login');
  const panel = document.getElementById('staff-orders');
  const message = document.getElementById('staff-message');
  const list = document.getElementById('order-list');
  let token = '', page = 1, loading = false;
  let loadingSession = -1;
  let sessionVersion = 0;
  const logout = () => {
  sessionVersion++;
  token = '';
  panel.hidden = true;
  login.hidden = false;
  login.reset();
  list.replaceChildren();
  message.textContent = 'Signed out.';
  };
  async function api(url, options = {}) {
    const requestSession = sessionVersion;
    const requestToken = token;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${requestToken}`
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });

    const data = await response.json();

    if (!response.ok) {
      if (
        response.status === 401 &&
        sessionVersion === requestSession
      ) {
        logout();
      }

      throw new Error(data.error || 'Request failed.');
    }

    return data;
  }
  async function load() {
    const currentSession = sessionVersion;

    if (loading && loadingSession === currentSession) return;

    loading = true;
    loadingSession = currentSession;
    message.textContent = 'Loading orders…';
    const requestToken = token;
    const requestSession = sessionVersion;
    try {
      const data = await api(`/api/admin/bookings?page=${page}`);
      if (!token || token !== requestToken || sessionVersion !== requestSession) return;
      panel.hidden = false; login.hidden = true; login.reset(); list.replaceChildren();
      for (const order of data.bookings) {
        const card = document.createElement('article'); card.className = 'order-card';
        const title = document.createElement('h2'); title.textContent = order.reference; card.append(title);
        const details = document.createElement('dl');
        const rows = { Customer: `${order.customer_name} — ${order.customer_phone}`, Service: order.service, 'Requested date': order.delivery_date, Recipient: `${order.recipient_name} — ${order.recipient_phone}`, Pickup: order.pickup_address, Destination: order.delivery_address, Size: order.package_size, Package: order.package_details, Received: new Date(order.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' WAT' };
        for (const [label, value] of Object.entries(rows)) {
          const dt = document.createElement('dt'), dd = document.createElement('dd');
          dt.textContent = label; dd.textContent = value; details.append(dt, dd);
        }
        card.append(details);
        const form = document.createElement('form'), select = document.createElement('select');
        const label = document.createElement('label'); label.textContent = 'Delivery status '; label.append(select);
        for (const [value, text] of Object.entries(data.statuses)) {
          const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
        }
        select.value = order.status;
        const button = document.createElement('button'); button.className = 'button button-blue'; button.textContent = 'Save status';
        form.append(label, button); card.append(form); list.append(card);
        form.addEventListener('submit', async event => {
          event.preventDefault();

          if (button.disabled) return;

          const statusSession = sessionVersion;
          button.disabled = true;

          try {
            const result = await api('/api/admin/status', {
              method: 'PATCH',
              body: JSON.stringify({
                reference: order.reference,
                status: select.value,
                version: order.version
              })
            });

            // Ignore responses from a previous login session.
            if (sessionVersion !== statusSession) return;

            order.version = result.version;
            order.status = result.status;
            message.textContent = `${order.reference}: ${result.label}.`;

          } catch (error) {
            if (sessionVersion === statusSession) {
              message.textContent = error.message;
            }
          } finally {
            button.disabled = false;
          }
        });
      }
      document.getElementById('previous').disabled = page === 1;
      document.getElementById('next').disabled = !data.hasMore;
      document.getElementById('page-label').textContent = `Page ${page}`;
      message.textContent = data.bookings.length ? 'Orders loaded. Times shown in West Africa Time.' : 'No orders on this page.';
    } catch (error) {
      if (sessionVersion === requestSession) {
        message.textContent = error.message;
      }
    } finally {
      if (loadingSession === currentSession) {
        loading = false;
        loadingSession = -1;
      }
    }
  }
  
  login.addEventListener('submit', event => {
  event.preventDefault();
  sessionVersion++;
  token = document.getElementById('staff-token').value.trim();
  page = 1;
  load();
  });

  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('previous').addEventListener('click', () => { if (page > 1 && !loading) { page--; load(); } });
  document.getElementById('next').addEventListener('click', () => { if (!loading) { page++; load(); } });
  // The staff token is kept only in this page's memory, never in browser storage.
})();
