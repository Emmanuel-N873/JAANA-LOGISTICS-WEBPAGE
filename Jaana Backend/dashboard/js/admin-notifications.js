// Booking notification polling, unread alerts, sound and staff acknowledgements.
// Shared staff events and API contracts: see docs/FRONTEND-GUIDE.md.
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id),
    api = (...args) => window.JaanaStaff.api(...args);
  let user = null,
    generation = 0,
    request = 0,
    timer = null,
    toastTimer = null,
    cursor = null,
    page = 1,
    delay = 15000,
    busy = false;
  let audio = null,
    sound = false,
    detail = null,
    ackBusy = false;
  const date = (value) =>
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
  const post = (action, reference) =>
    api('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({ action, reference }),
    });
  function schedule(ms = delay) {
    clearTimeout(timer);
    if (user && !document.hidden) timer = setTimeout(() => poll(), ms);
  }
  function tone() {
    if (!sound || !audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(),
      volume = audio.createGain();
    oscillator.connect(volume);
    volume.connect(audio.destination);
    oscillator.frequency.value = 740;
    volume.gain.setValueAtTime(0.08, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.32);
  }
  function announce(count) {
    byId('notification-toast-text').textContent =
      count === 1
        ? 'A new delivery request has arrived.'
        : count + ' new delivery requests have arrived.';
    byId('notification-toast').hidden = false;
    tone();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      byId('notification-toast').hidden = true;
    }, 12000);
  }
  function updateAcknowledgement(order, acknowledgement) {
    detail = { reference: order.reference, status: order.status, acknowledgement };
    byId('detail-acknowledgement').textContent = acknowledgement
      ? 'Acknowledged by ' +
        acknowledgement.staff_name +
        ' on ' +
        date(acknowledgement.acknowledged_at)
      : 'No staff member has acknowledged this booking yet.';
    byId('acknowledge-order').hidden =
      !!acknowledgement || ['delivered', 'cancelled'].includes(order.status);
    byId('acknowledge-order').disabled = false;
    byId('acknowledgement-message').textContent = '';
  }
  async function acknowledge(reference) {
    const version = generation;
    const data = await post('acknowledge', reference);
    if (version !== generation) return;
    await poll(true);
    if (version === generation && byId('order-dialog').open && detail?.reference === reference) {
      await window.JaanaStaff.openOrder(reference, true);
      if (version === generation && detail?.reference === reference)
        byId('acknowledgement-message').textContent =
          'Acknowledgement saved against your staff account.';
    }
    return data;
  }
  function render(data) {
    const count = byId('notification-count');
    count.textContent = data.unread > 99 ? '99+' : String(data.unread);
    count.hidden = data.unread === 0;
    byId('notification-bell').setAttribute(
      'aria-label',
      `Booking notifications, ${data.unread} unread`
    );
    byId('notification-list').replaceChildren();
    for (const entry of data.notifications) {
      const item = node('li');
      if (!entry.read_at) item.className = 'is-unread';
      item.append(
        node('strong', (entry.read_at ? '' : 'Unread: ') + 'New delivery request'),
        node('p', entry.reference),
        node('p', entry.service)
      );
      const time = node('time', date(entry.created_at));
      time.dateTime = entry.created_at;
      item.append(time);
      item.append(
        node(
          'p',
          entry.acknowledged_name
            ? 'Acknowledged by ' + entry.acknowledged_name + ' on ' + date(entry.acknowledged_at)
            : 'Awaiting staff acknowledgement'
        )
      );
      const actions = node('div');
      actions.className = 'notification-actions';
      const button = (label, handler) => {
        const el = node('button', label);
        el.type = 'button';
        el.className = 'pager-button';
        el.addEventListener('click', async () => {
          if (el.disabled) return;
          const version = generation;
          el.disabled = true;
          try {
            await handler(version);
          } catch (error) {
            if (version === generation) {
              byId('notification-message').textContent = error.message;
              await poll(true);
            }
          } finally {
            if (version === generation) el.disabled = false;
          }
        });
        actions.append(el);
      };
      button('View booking', async (version) => {
        await post('read', entry.reference);
        if (version !== generation) return;
        byId('notifications-dialog').close();
        await window.JaanaStaff.openOrder(entry.reference);
        if (version === generation) await poll(true);
      });
      if (!entry.read_at)
        button('Mark read', async (version) => {
          await post('read', entry.reference);
          if (version === generation) await poll(true);
        });
      if (!entry.acknowledged_by && !['delivered', 'cancelled'].includes(entry.status))
        button('Acknowledge booking', () => acknowledge(entry.reference));
      item.append(actions);
      byId('notification-list').append(item);
    }
    byId('notification-page').textContent =
      'Page ' + data.page + ' | ' + data.total + ' notifications';
    byId('notification-previous').disabled = page <= 1;
    byId('notification-next').disabled = page * data.pageSize >= data.total;
    if (!data.total) byId('notification-list').append(node('li', 'No booking notifications yet.'));
  }
  async function poll(replace = false) {
    if (!user || document.hidden) return;
    if (busy && !replace) return;
    clearTimeout(timer);
    busy = true;
    const version = generation,
      operation = ++request;
    const params = new URLSearchParams({ page: String(page) });
    if (cursor !== null) params.set('after', String(cursor));
    try {
      const data = await api('/api/admin/notifications?' + params);
      if (version !== generation || operation !== request || document.hidden) return;
      render(data);
      if (cursor !== null && data.fresh.length) announce(data.fresh.length);
      cursor = data.cursor;
      delay = 15000;
      byId('notification-message').textContent =
        'Updated ' +
        date(new Date().toISOString()) +
        '. Checks every 15 seconds while this dashboard is visible.';
      if (data.hasMoreFresh) delay = 150;
    } catch (error) {
      if (version === generation && operation === request) {
        delay = Math.min(Math.max(delay, 15000) * 2, 120000);
        byId('notification-message').textContent =
          'Notifications could not refresh. Retrying automatically. ' + error.message;
      }
    } finally {
      if (version === generation && operation === request) {
        busy = false;
        schedule();
      }
    }
  }
  window.addEventListener('staff-session', (event) => {
    generation++;
    request++;
    clearTimeout(timer);
    clearTimeout(toastTimer);
    user =
      event.detail && !event.detail.mustChangePassword && !event.detail.mustEnrollMfa
        ? event.detail
        : null;
    busy = false;
    cursor = null;
    page = 1;
    delay = 15000;
    detail = null;
    ackBusy = false;
    byId('notification-bell').hidden = !user;
    byId('notification-count').hidden = true;
    byId('notification-count').textContent = '0';
    byId('notification-bell').setAttribute('aria-label', 'Booking notifications');
    byId('notification-toast').hidden = true;
    byId('notification-list').replaceChildren();
    byId('notification-message').textContent = '';
    byId('notification-page').textContent = '';
    byId('detail-acknowledgement').textContent = '';
    byId('acknowledgement-message').textContent = '';
    byId('acknowledge-order').hidden = true;
    if (byId('notifications-dialog').open) byId('notifications-dialog').close();
    sound = false;
    byId('notification-sound').textContent = 'Enable sound';
    byId('notification-sound').setAttribute('aria-pressed', 'false');
    if (audio) {
      audio.close().catch(() => {});
      audio = null;
    }
    if (user) poll();
  });
  window.addEventListener('staff-order', (event) =>
    updateAcknowledgement(event.detail.order, event.detail.acknowledgement)
  );
  byId('acknowledge-order').addEventListener('click', async () => {
    if (!user || !detail || ackBusy || !byId('order-dialog').open) return;
    const reference = detail.reference,
      version = generation;
    ackBusy = true;
    byId('acknowledge-order').disabled = true;
    try {
      await acknowledge(reference);
    } catch (error) {
      if (version === generation && detail?.reference === reference && byId('order-dialog').open) {
        await window.JaanaStaff.openOrder(reference, true);
        if (version === generation && detail?.reference === reference)
          byId('acknowledgement-message').textContent = error.message;
      }
    } finally {
      if (version === generation) {
        ackBusy = false;
        byId('acknowledge-order').disabled = false;
      }
    }
  });
  const openHistory = () => {
    if (!user) return;
    byId('notifications-dialog').showModal();
    byId('notification-toast').hidden = true;
    poll(true);
  };
  byId('notification-bell').addEventListener('click', openHistory);
  byId('notification-toast-open').addEventListener('click', openHistory);
  byId('close-notifications').addEventListener('click', () => byId('notifications-dialog').close());
  byId('notification-toast-dismiss').addEventListener('click', () => {
    byId('notification-toast').hidden = true;
  });
  byId('refresh-notifications').addEventListener('click', () => poll(true));
  byId('notification-previous').addEventListener('click', () => {
    if (page > 1) {
      page--;
      poll(true);
    }
  });
  byId('notification-next').addEventListener('click', () => {
    if (!byId('notification-next').disabled) {
      page++;
      poll(true);
    }
  });
  byId('notification-sound').addEventListener('click', async () => {
    const version = generation;
    if (sound) {
      sound = false;
      byId('notification-sound').textContent = 'Enable sound';
      byId('notification-sound').setAttribute('aria-pressed', 'false');
      return;
    }
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('Sound alerts are unavailable in this browser.');
      audio = audio || new Audio();
      await audio.resume();
      if (version !== generation) return;
      sound = true;
      byId('notification-sound').textContent = 'Mute sound';
      byId('notification-sound').setAttribute('aria-pressed', 'true');
      tone();
    } catch (error) {
      if (version === generation) byId('notification-message').textContent = error.message;
    }
  });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden && user) poll(true);
  });
  window.addEventListener('online', () => {
    if (user) poll(true);
  });
})();
