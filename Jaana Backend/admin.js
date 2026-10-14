(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const login = byId('staff-login'), panel = byId('staff-orders');
  const message = byId('staff-message'), list = byId('order-list');
  const detailDialog = byId('order-dialog'), detailMessage = byId('detail-message');
  let token = '', page = 1, loading = false;
  let loadingSession = -1, sessionVersion = 0, loadVersion = 0;
  let detailVersion = 0, statusVersion = 0, currentOrder = null, searchTimer;
  let statusLabels = {};

  const errorText = error => error.name === 'TimeoutError' ? 'The service took too long to respond. Please retry.' : error.name === 'TypeError' ? 'Could not reach the order service. Check your connection and retry.' : error.message;
  const dateTime = value => new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) + ' WAT';
  const deliveryDate = value => new Date(value + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric' });
  const closeNavigation = () => {
    document.body.classList.remove('nav-open');
    byId('menu-toggle').setAttribute('aria-expanded', 'false');
    byId('nav-shade').hidden = true;
  };
  const syncNavigation = () => document.querySelectorAll('[data-nav-status]').forEach(button => {
    const active = button.dataset.navStatus === byId('status-filter').value;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const badge = status => {
    const span = document.createElement('span');
    span.className = 'status-badge status-' + status;
    span.textContent = statusLabels[status] || status;
    return span;
  };
  const resetFilters = () => { byId('order-filters').reset(); page = 1; syncNavigation(); };
  const setIdentity = user => {
    token = user ? user.id : '';
    byId('staff-name').textContent = user?.name || 'JAANA Team';
    byId('staff-role').textContent = user ? (user.role === 'admin' ? 'Administrator' : 'Staff') : 'Staff access';
    byId('staff-initials').textContent = user ? user.name.split(/\s+/).map(part => part[0]).slice(0,2).join('').toUpperCase() : 'JA';
    byId('welcome-name').textContent = user?.name || 'JAANA team';
    byId('account-settings').hidden = !user;
    byId('manage-staff').hidden = !user || user.role !== 'admin' || user.mustChangePassword;
    byId('view-activity').hidden = !user || user.role !== 'admin' || user.mustChangePassword;
    window.dispatchEvent(new CustomEvent('staff-session', { detail: user }));
  };
  const logout = () => {
    sessionVersion++; loadVersion++; detailVersion++; statusVersion++;
    setIdentity(null); currentOrder = null; loading = false; loadingSession = -1;
    clearTimeout(searchTimer);
    panel.hidden = true; byId('login-panel').hidden = false; byId('logout').hidden = true;
    login.reset(); byId('login-submit').disabled = false;
    list.replaceChildren(); byId('detail-fields').replaceChildren(); byId('detail-history').replaceChildren();
    byId('detail-reference').value = ''; detailMessage.textContent = ''; byId('detail-content').hidden = true;
    if (detailDialog.open) detailDialog.close();
    if (byId('help-dialog').open) byId('help-dialog').close();
    document.querySelectorAll('.summary-card strong').forEach(element => { element.textContent = '0'; });
    resetFilters(); closeNavigation(); message.textContent = 'Signed out.';
  };
  async function api(url, options = {}) {
    const requestSession = sessionVersion;
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('The order service is unavailable. Please retry.'); }
    if (!response.ok) {
      if (response.status === 401 && sessionVersion === requestSession) logout();
      const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error;
    }
    if (sessionVersion !== requestSession) throw new Error('Session changed.');
    return data;
  }
  function fillOptions(select, entries) {
    const value = select.value;
    select.replaceChildren();
    for (const [key, text] of entries) {
      const option = document.createElement('option'); option.value = key; option.textContent = text; select.append(option);
    }
    select.value = value;
  }
  function renderOrders(data) {
    statusLabels = data.statuses;
    fillOptions(byId('status-filter'), [['', 'All statuses'], ...Object.entries(data.statuses)]);
    fillOptions(byId('area-filter'), [['', 'All areas'], ...data.areas.map(area => [area, area])]);
    byId('summary-total').textContent = data.summary.total;
    byId('summary-progress').textContent = data.summary.inProgress;
    byId('summary-delivered').textContent = data.summary.deliveredToday;
    byId('summary-pending').textContent = data.summary.pending;
    byId('summary-cancelled').textContent = data.summary.cancelled;
    list.replaceChildren();
    for (const [index, order] of data.bookings.entries()) {
      const row = document.createElement('tr');
      const cell = value => { const td = document.createElement('td'); if (value instanceof Node) td.append(value); else td.textContent = value; row.append(td); };
      cell((data.page - 1) * data.pageSize + index + 1);
      const reference = document.createElement('button'); reference.className = 'reference-link'; reference.type = 'button';
      reference.textContent = order.reference; reference.setAttribute('aria-label', 'View order ' + order.reference);
      reference.addEventListener('click', () => openOrder(order.reference)); cell(reference);
      cell(order.customer_name); cell(order.pickup_address); cell(order.delivery_address); cell(order.service);
      cell(deliveryDate(order.delivery_date)); cell(badge(order.status));
      const view = document.createElement('button'); view.className = 'view-button'; view.type = 'button'; view.textContent = 'View';
      view.setAttribute('aria-label', 'View details for ' + order.reference); view.addEventListener('click', () => openOrder(order.reference)); cell(view);
      list.append(row);
    }
    byId('empty-state').hidden = data.bookings.length !== 0;
    const start = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    const end = Math.min(data.page * data.pageSize, data.total);
    byId('result-count').textContent = `${data.total} matching ${data.total === 1 ? 'booking' : 'bookings'}`;
    byId('page-label').textContent = `Showing ${start}-${end} of ${data.total}`;
    byId('previous').disabled = page <= 1; byId('next').disabled = !data.hasMore;
    syncNavigation();
  }
  async function load({ replace = false } = {}) {
    const currentSession = sessionVersion;
    if (!token || (loading && loadingSession === currentSession && !replace)) return;
    loading = true; loadingSession = currentSession;
    const requestVersion = ++loadVersion, requestToken = token, requestSession = sessionVersion;
    byId('login-submit').disabled = true; byId('refresh').disabled = true;
    panel.setAttribute('aria-busy', 'true'); message.textContent = 'Loading orders...';
    const params = new URLSearchParams({ page: String(page), q: byId('search').value.trim(), status: byId('status-filter').value, area: byId('area-filter').value, date: byId('date-filter').value });
    try {
      const data = await api('/api/admin/bookings?' + params);
      if (!token || token !== requestToken || sessionVersion !== requestSession || loadVersion !== requestVersion) return;
      renderOrders(data);
      panel.hidden = false; byId('login-panel').hidden = true; byId('logout').hidden = false;
      message.textContent = data.total ? 'Orders are up to date. Summary cards show all saved orders.' : 'No bookings match your filters.';
    } catch (error) {
      if (sessionVersion === requestSession && loadVersion === requestVersion) message.textContent = errorText(error);
    } finally {
      if (loadingSession === currentSession && loadVersion === requestVersion) {
        loading = false; loadingSession = -1; panel.removeAttribute('aria-busy');
        byId('login-submit').disabled = false; byId('refresh').disabled = false;
      }
    }
  }
  function renderDetails(data) {
    const order = data.order; currentOrder = order; statusLabels = data.statuses;
    byId('detail-reference').value = order.reference;
    byId('detail-status').replaceChildren(badge(order.status));
    const fields = {
      Customer: order.customer_name, 'Customer phone': order.customer_phone,
      Recipient: order.recipient_name, 'Recipient phone': order.recipient_phone,
      Service: order.service, 'Delivery date': deliveryDate(order.delivery_date),
      'Package size': order.package_size, 'Pickup address': order.pickup_address,
      'Delivery address': order.delivery_address, 'Package details': order.package_details,
      Received: dateTime(order.created_at), 'Last updated': dateTime(order.updated_at)
    };
    const details = byId('detail-fields'); details.replaceChildren();
    for (const [key, value] of Object.entries(fields)) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; details.append(dt, dd);
    }
    fillOptions(byId('detail-status-select'), Object.entries(data.statuses)); byId('detail-status-select').value = order.status;
    byId('detail-history').replaceChildren();
    for (const event of data.events) {
      const li = document.createElement('li'), time = document.createElement('time');
      li.textContent = (data.statuses[event.status] || event.status) + (event.staff_name ? ' — ' + event.staff_name + ' (' + event.staff_role + ')' : ''); time.dateTime = event.created_at; time.textContent = dateTime(event.created_at); li.append(time); byId('detail-history').append(li);
    }
    byId('detail-content').hidden = false; byId('save-status').disabled = false;
  }
  async function openOrder(reference, keepOpen = false) {
    if (!token) return;
    const requestSession = sessionVersion, requestVersion = ++detailVersion;
    statusVersion++; currentOrder = null;
    byId('detail-content').hidden = true; detailMessage.textContent = 'Loading booking details...';
    if (!detailDialog.open) detailDialog.showModal();
    try {
      const data = await api('/api/admin/order?' + new URLSearchParams({ reference }));
      if (!token || sessionVersion !== requestSession || detailVersion !== requestVersion || !detailDialog.open) return;
      renderDetails(data); detailMessage.textContent = keepOpen ? 'Booking refreshed.' : '';
    } catch (error) {
      if (sessionVersion === requestSession && detailVersion === requestVersion && detailDialog.open) detailMessage.textContent = errorText(error);
    }
  }
  byId('status-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = byId('save-status');
    if (!token || !currentOrder || button.disabled) return;
    const order = currentOrder, statusSession = sessionVersion, operation = ++statusVersion;
    const chosenStatus = byId('detail-status-select').value;
    button.disabled = true; detailMessage.textContent = 'Saving status...';
    try {
      const result = await api('/api/admin/status', { method: 'PATCH', body: JSON.stringify({ reference: order.reference, status: chosenStatus, version: order.version }) });
      if (sessionVersion !== statusSession) return;
      if (statusVersion === operation && currentOrder === order && detailDialog.open) {
        await openOrder(order.reference, true);
        if (sessionVersion === statusSession && currentOrder?.reference === order.reference && detailDialog.open) detailMessage.textContent = 'Status saved: ' + result.label + '.';
      }
      if (sessionVersion === statusSession) await load({ replace: true });
    } catch (error) {
      if (sessionVersion === statusSession && statusVersion === operation && detailDialog.open) {
        detailMessage.textContent = errorText(error);
        if (error.status === 409) { await openOrder(order.reference, true); if (sessionVersion === statusSession && currentOrder?.reference === order.reference) detailMessage.textContent = 'This order changed. Latest details loaded; review the status before saving again.'; }
      }
    } finally {
      if (sessionVersion === statusSession && statusVersion === operation) button.disabled = false;
    }
  });
  byId('copy-reference').addEventListener('click', async () => {
    if (!currentOrder) return;
    const requestSession = sessionVersion, reference = currentOrder.reference;
    try { await navigator.clipboard.writeText(reference); if (sessionVersion === requestSession && currentOrder?.reference === reference) detailMessage.textContent = 'Reference copied.'; }
    catch { if (sessionVersion === requestSession && currentOrder?.reference === reference) { byId('detail-reference').select(); detailMessage.textContent = 'Reference selected. Use your device copy command.'; } }
  });
  const closeDetails = () => { detailVersion++; statusVersion++; currentOrder = null; if (detailDialog.open) detailDialog.close(); };
  byId('close-detail').addEventListener('click', closeDetails);
  detailDialog.addEventListener('close', () => { if (detailDialog.open) return; detailVersion++; statusVersion++; currentOrder = null; byId('detail-content').hidden = true; byId('detail-fields').replaceChildren(); byId('detail-history').replaceChildren(); byId('detail-reference').value = ''; });
  login.addEventListener('submit', async event => {
    event.preventDefault(); if (byId('login-submit').disabled) return;
    sessionVersion++; loadVersion++;
    const requestSession = sessionVersion;
    const email = byId('staff-email').value, password = byId('staff-password').value;
    byId('staff-password').value = ''; byId('login-submit').disabled = true;
    try {
      const data = await api('/api/staff?action=login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (sessionVersion !== requestSession) return;
      setIdentity(data.user); login.reset(); page = 1;
      byId('logout').hidden = false; byId('login-panel').hidden = true;
      if (data.user.mustChangePassword) { message.textContent = 'Change your temporary password to continue.'; return; }
      await load({ replace: true });
    } catch (error) { if (!token) message.textContent = errorText(error); }
    finally { byId('login-submit').disabled = false; }
  });
  const filterChanged = () => { clearTimeout(searchTimer); page = 1; syncNavigation(); if (token) load({ replace: true }); };
  byId('order-filters').addEventListener('submit', event => { event.preventDefault(); filterChanged(); });
  byId('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(filterChanged, 400); });
  for (const id of ['status-filter', 'area-filter', 'date-filter']) byId(id).addEventListener('change', filterChanged);
  byId('clear-filters').addEventListener('click', () => { resetFilters(); filterChanged(); });
  document.querySelectorAll('[data-nav-status]').forEach(button => button.addEventListener('click', () => {
    if (!token) { message.textContent = 'Sign in to view delivery orders.'; closeNavigation(); byId('staff-email').focus(); return; }
    resetFilters(); byId('status-filter').value = button.dataset.navStatus; filterChanged(); closeNavigation();
  }));
  byId('refresh').addEventListener('click', () => load()); byId('logout').addEventListener('click', async () => {
    byId('logout').disabled = true;
    try { await api('/api/staff?action=logout', { method:'POST', body:'{}' }); logout(); }
    catch (error) { message.textContent = errorText(error); }
    finally { byId('logout').disabled = false; }
  });
  byId('previous').addEventListener('click', () => { if (page > 1 && !loading) { page--; load(); } });
  byId('next').addEventListener('click', () => { if (!loading && !byId('next').disabled) { page++; load(); } });
  byId('help').addEventListener('click', () => { closeNavigation(); byId('help-dialog').showModal(); });
  byId('close-help').addEventListener('click', () => byId('help-dialog').close());
  byId('menu-toggle').addEventListener('click', () => { const open = document.body.classList.toggle('nav-open'); byId('menu-toggle').setAttribute('aria-expanded', String(open)); byId('nav-shade').hidden = !open; });
  byId('nav-shade').addEventListener('click', closeNavigation);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNavigation(); });
  window.matchMedia('(min-width:1001px)').addEventListener('change', event => { if (event.matches) closeNavigation(); });
  syncNavigation();
  window.JaanaStaff = { api, logout };
  setTimeout(async () => {
    const requestSession = sessionVersion;
    byId('login-submit').disabled = true;
    try {
      const response = await fetch('/api/staff', { credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(15000) });
      if (sessionVersion !== requestSession || !response.ok) return;
      const data = await response.json();
      if (sessionVersion !== requestSession) return;
      setIdentity(data.user); byId('login-panel').hidden = true; byId('logout').hidden = false;
      if (!data.user.mustChangePassword) await load({ replace:true });
    } catch { /* Sign-in remains available when session restoration fails. */ }
    finally { if (sessionVersion === requestSession) byId('login-submit').disabled = false; }
  }, 0);
  // Staff credentials and customer data are never written to browser storage.
})();
