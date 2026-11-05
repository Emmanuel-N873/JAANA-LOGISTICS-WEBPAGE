// Staff password changes, administrator account management and audit history.
// Shared staff events and API contracts: see docs/FRONTEND-GUIDE.md.
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id),
    api = (...args) => window.JaanaStaff.api(...args);
  let user = null,
    generation = 0,
    activityPage = 1,
    activityRequest = 0;
  const time = (value) =>
    new Date(value).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' WAT';
  const node = (tag, text) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const post = (url, data) => api(url, { method: 'POST', body: JSON.stringify(data) });
  const errorMessage = (error) =>
    error.name === 'TypeError' ? 'Could not reach the server. Please retry.' : error.message;
  document
    .querySelectorAll('[data-close]')
    .forEach((button) =>
      button.addEventListener('click', () => byId(button.dataset.close).close())
    );
  window.addEventListener('staff-session', (event) => {
    user = event.detail;
    generation++;
    activityRequest++;
    for (const id of ['accounts-dialog', 'activity-dialog', 'password-dialog'])
      if (byId(id).open) byId(id).close();
    for (const id of ['staff-account-list', 'activity-list']) byId(id).replaceChildren();
    for (const id of ['create-staff', 'change-password', 'activity-filters']) byId(id).reset();
    byId('activity-filters').elements.staff.replaceChildren(new Option('All staff', ''));
    for (const id of ['accounts-message', 'password-message', 'activity-message', 'activity-page'])
      byId(id).textContent = '';
    if (user?.mustChangePassword) {
      byId('password-message').textContent = 'Set your own password before accessing bookings.';
      byId('password-dialog').showModal();
    }
  });
  for (const id of ['accounts-dialog', 'password-dialog'])
    byId(id).addEventListener('close', () => {
      byId(id)
        .querySelectorAll('input[type=password]')
        .forEach((input) => (input.value = ''));
    });
  byId('account-settings').addEventListener('click', () => {
    byId('password-message').textContent = 'Changing your password signs out all your sessions.';
    byId('password-dialog').showModal();
  });
  byId('change-password').addEventListener('submit', async (event) => {
    event.preventDefault();
    const version = generation,
      button = event.submitter;
    if (button.disabled) return;
    button.disabled = true;
    const data = Object.fromEntries(new FormData(event.target));
    event.target.reset();
    try {
      await post('/api/staff?action=password', data);
      if (version !== generation) return;
      window.JaanaStaff.logout();
      byId('staff-message').textContent = 'Password changed. Sign in with your new password.';
    } catch (error) {
      if (version === generation) byId('password-message').textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
  function field(form, label, type, name, value) {
    const wrap = node('label', label);
    const input = node(type === 'select' ? 'select' : 'input');
    input.name = name;
    if (type !== 'select') input.type = type;
    if (type === 'text') input.maxLength = 100;
    if (type === 'password') {
      input.minLength = 14;
      input.maxLength = 128;
      input.autocomplete = 'new-password';
    }
    if (type === 'checkbox') input.checked = !!value;
    else input.value = value || '';
    wrap.append(input);
    form.append(wrap);
    return input;
  }
  async function loadAccounts() {
    const version = generation;
    byId('accounts-message').textContent = 'Loading staff accounts...';
    try {
      const data = await api('/api/admin/staff');
      if (version !== generation) return;
      byId('staff-account-list').replaceChildren();
      for (const account of data.users) {
        const form = node('form');
        form.className = 'account-form staff-account';
        form.append(node('h4', account.name), node('p', account.email));
        field(form, 'Name', 'text', 'name', account.name).required = true;
        const role = field(form, 'Role', 'select', 'role');
        role.append(new Option('Staff', 'staff'), new Option('Administrator', 'admin'));
        role.value = account.role;
        field(form, 'Account active', 'checkbox', 'active', account.active);
        const password = field(
          form,
          'New temporary password (for reset only)',
          'password',
          'password'
        );
        const actions = node('div');
        actions.className = 'account-actions';
        for (const [value, label] of [
          ['update', 'Save account'],
          ['reset', 'Reset password'],
          ['resetMfa', 'Reset authenticator'],
        ]) {
          const button = node('button', label);
          button.type = 'submit';
          button.value = value;
          button.className = 'pager-button';
          actions.append(button);
        }
        form.append(actions);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const requestGeneration = generation,
            action = event.submitter.value;
          const buttons = [...form.querySelectorAll('button')];
          if (buttons.some((b) => b.disabled)) return;
          const payload = {
            action,
            id: account.id,
            version: account.version,
            name: form.elements.name.value,
            role: role.value,
            active: form.elements.active.checked,
          };
          if (action === 'resetMfa') {
            const reason = prompt(
              'After independently verifying this staff member?s identity, record the verification method. This revokes sessions and removes the authenticator.'
            );
            if (!reason || reason.trim().length < 12) return;
            payload.reason = reason.trim();
          }
          if (action === 'reset') {
            if (password.value.length < 14) {
              byId('accounts-message').textContent =
                'Enter a temporary password of at least 14 characters.';
              password.focus();
              return;
            }
            payload.password = password.value;
          }
          buttons.forEach((b) => (b.disabled = true));
          password.value = '';
          try {
            await post('/api/admin/staff', payload);
            if (requestGeneration !== generation) return;
            if (account.id === user.id) {
              window.JaanaStaff.logout();
              byId('staff-message').textContent = 'Your account changed. Sign in again.';
              return;
            }
            await loadAccounts();
            if (requestGeneration === generation)
              byId('accounts-message').textContent =
                action === 'reset'
                  ? 'Password reset. Share the temporary password privately.'
                  : 'Account saved. Previous sessions have been revoked.';
          } catch (error) {
            if (requestGeneration === generation)
              byId('accounts-message').textContent = errorMessage(error);
          } finally {
            buttons.forEach((b) => (b.disabled = false));
          }
        });
        byId('staff-account-list').append(form);
      }
      byId('accounts-message').textContent = data.users.length + ' staff accounts';
    } catch (error) {
      if (version === generation) byId('accounts-message').textContent = errorMessage(error);
    }
  }
  byId('manage-staff').addEventListener('click', () => {
    byId('accounts-dialog').showModal();
    loadAccounts();
  });
  byId('create-staff').addEventListener('submit', async (event) => {
    event.preventDefault();
    const version = generation,
      button = event.submitter;
    if (button.disabled) return;
    button.disabled = true;
    const payload = { action: 'create', ...Object.fromEntries(new FormData(event.target)) };
    event.target.elements.password.value = '';
    try {
      await post('/api/admin/staff', payload);
      if (version !== generation) return;
      event.target.reset();
      await loadAccounts();
      if (version === generation)
        byId('accounts-message').textContent =
          'Account created. Share its temporary password privately.';
    } catch (error) {
      if (version === generation) byId('accounts-message').textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
  async function loadActivity() {
    const version = generation,
      request = ++activityRequest;
    byId('activity-message').textContent = 'Loading activity...';
    const params = new URLSearchParams(new FormData(byId('activity-filters')));
    params.set('page', activityPage);
    try {
      const data = await api('/api/admin/activity?' + params);
      if (version !== generation || request !== activityRequest) return;
      byId('activity-list').replaceChildren();
      for (const entry of data.events) {
        const li = node('li');
        li.append(
          node('strong', entry.staff_name + ' (' + entry.staff_role + ')'),
          node('p', entry.action + (entry.target ? ' | ' + entry.target : ''))
        );
        const timestamp = node('time', time(entry.created_at));
        timestamp.dateTime = entry.created_at;
        li.append(timestamp);
        if (entry.staff_id) li.append(node('small', 'Staff ID: ' + entry.staff_id));
        const details = JSON.parse(entry.details);
        if (Object.keys(details).length) {
          const pre = node('pre', JSON.stringify(details, null, 2));
          li.append(pre);
        }
        byId('activity-list').append(li);
      }
      byId('activity-message').textContent = data.total ? '' : 'No matching activity.';
      byId('activity-page').textContent = 'Page ' + data.page + ' | ' + data.total + ' events';
      byId('activity-previous').disabled = activityPage <= 1;
      byId('activity-next').disabled = activityPage * data.pageSize >= data.total;
    } catch (error) {
      if (version === generation && request === activityRequest)
        byId('activity-message').textContent = errorMessage(error);
    }
  }
  byId('view-activity').addEventListener('click', async () => {
    const version = generation;
    byId('activity-dialog').showModal();
    activityPage = 1;
    try {
      const data = await api('/api/admin/staff');
      if (version !== generation) return;
      const select = byId('activity-filters').elements.staff;
      select.replaceChildren(new Option('All staff', ''));
      for (const account of data.users) select.append(new Option(account.name, account.id));
      await loadActivity();
    } catch (error) {
      if (version === generation) byId('activity-message').textContent = errorMessage(error);
    }
  });
  byId('activity-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    activityPage = 1;
    loadActivity();
  });
  byId('activity-previous').addEventListener('click', () => {
    if (activityPage > 1) {
      activityPage--;
      loadActivity();
    }
  });
  byId('activity-next').addEventListener('click', () => {
    activityPage++;
    loadActivity();
  });
})();
