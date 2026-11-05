// Shared homepage controls: mobile navigation and native HTML dialogs.
(() => {
  'use strict';
  const menuToggle = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#main-nav');
  const dialogOpeners = new WeakMap();
  const firstMenuItem = () => navigation.querySelector('a, button');
  const closeMenu = ({ returnFocus = false } = {}) => {
    const wasOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
    // Return focus only when this action actually closed an open menu.
    if (wasOpen && returnFocus) menuToggle.focus();
  };
  menuToggle.addEventListener('click', () => {
    const expanded = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(expanded));
    navigation.classList.toggle('is-open', expanded);
    if (expanded) firstMenuItem()?.focus();
  });
  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu({ returnFocus: true });
  });
  document.querySelectorAll('[data-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.dialog);
      if (!dialog) return;
      dialogOpeners.set(dialog, button);
      dialog.showModal();
      document.body.classList.add('dialog-open');
      // Move focus into the dialog so keyboard users know where they are.
      dialog.querySelector('input, select, textarea, button, a[href]')?.focus();
    });
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog
      .querySelectorAll('.dialog-close, [data-close-dialog]')
      .forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
      // Native dialogs usually restore focus, but doing it explicitly keeps behavior predictable.
      queueMicrotask(() => {
        if (document.querySelector('dialog[open]')) return;
        dialogOpeners.get(dialog)?.focus();
      });
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        dialog.close();
    });
  });
})();
