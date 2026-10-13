(() => {
 'use strict';
 const menuToggle = document.querySelector('.menu-toggle');
 const navigation = document.querySelector('#main-nav');
 const closeMenu = () => { menuToggle.setAttribute('aria-expanded','false'); navigation.classList.remove('is-open'); };
 menuToggle.addEventListener('click', () => { const expanded = menuToggle.getAttribute('aria-expanded') !== 'true'; menuToggle.setAttribute('aria-expanded',String(expanded)); navigation.classList.toggle('is-open',expanded); });
 navigation.addEventListener('click', event => { if(event.target.closest('a, button')) closeMenu(); });
 document.addEventListener('keydown', event => { if(event.key === 'Escape') closeMenu(); });
 document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => { document.getElementById(button.dataset.dialog).showModal(); document.body.classList.add('dialog-open'); }));
 document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('.dialog-close, [data-close-dialog]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { if(!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open'); });
  dialog.addEventListener('click', event => { if(event.target !== dialog) return; const bounds=dialog.getBoundingClientRect(); if(event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); });
 });
 const labels={name:'Name',phone:'Phone',pickup:'Pickup',destination:'Delivery location',package:'Package details',reference:'Delivery reference',service:'Service type',date:'Preferred delivery date',recipient:'Recipient name',recipientPhone:'Recipient phone',size:'Approximate package size'};
 const lagosToday = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
 };
 document.querySelectorAll('input[type="date"]').forEach(input => {
  const refresh = () => { input.min = lagosToday(); };
  refresh();
  input.addEventListener('focus', refresh);
 });
 document.querySelectorAll('form[data-request]').forEach(form => {
  form.addEventListener('submit', event => {
   event.preventDefault(); const fields=[...new FormData(form).entries()];
   for(const [name,value] of fields) {
    const field = form.elements.namedItem(name);
    const trimmed = String(value).trim();
    field.setCustomValidity(field.required && !trimmed ? 'Please enter this information.' : '');
    if (field.type === 'date' && trimmed) {
     field.min = lagosToday();
     if (trimmed < field.min) field.setCustomValidity('Please choose today or a future date.');
     else if (new Date(trimmed + 'T12:00:00Z').getUTCDay() === 0) field.setCustomValidity('Please choose Monday to Saturday, when our team is available.');
    }
   }
   if(!form.reportValidity()) return;
   const message=['Hello JAANA Logistics,',form.dataset.request,'',...fields.map(([name,value]) => `${labels[name] || name}: ${String(value).trim()}`)].join('\n');
   window.open(`https://wa.me/2348038422591?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
  });
  form.addEventListener('input', event => { if(typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity(''); });
 });
 const carousel = document.querySelector('.service-carousel');
 const track = carousel.querySelector('.services-grid');
 const slides = [...track.querySelectorAll('.service-card')];
 const boundaryCopy = slide => {
  const copy = slide.cloneNode(true);
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  copy.dataset.carouselClone = 'true';
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.querySelector('img').loading = 'eager';
  return copy;
 };
 track.prepend(boundaryCopy(slides[slides.length - 1]));
 track.append(boundaryCopy(slides[0]));
 const dots = carousel.querySelector('.carousel-dots');
 const pauseButton = carousel.querySelector('.carousel-pause');
 const status = carousel.querySelector('.carousel-status');
 const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
 let current = -1;
 let wrapping = false;
 let wrapTimer;
 let playing = !reducedMotion.matches;
 let timer;
 let pointerStart;

 const settleWrap = () => {
  clearTimeout(wrapTimer);
  wrapping = false;
  track.style.transition = 'none';
  track.style.transform = `translateX(-${(current + 1) * 100}%)`;
  void track.offsetWidth;
  track.style.transition = '';
 };
 track.addEventListener('transitionend', event => {
  if (event.target === track && event.propertyName === 'transform' && wrapping) settleWrap();
 });
 const showSlide = (index, announce = false) => {
  if (wrapping) settleWrap();
  const previous = current;
  current = (index + slides.length) % slides.length;
  let position = current + 1;
  if (previous === slides.length - 1 && current === 0) { position = slides.length + 1; wrapping = true; }
  if (previous === 0 && current === slides.length - 1) { position = 0; wrapping = true; }
  // Fetch the active image and its successor before automatic rotation needs it.
  [current, (current + 1) % slides.length].forEach(position => {
   slides[position].querySelector('.service-photo').loading = 'eager';
  });
  if (previous === -1 || reducedMotion.matches) {
   settleWrap();
  } else {
   track.style.transform = `translateX(-${position * 100}%)`;
   if (wrapping) wrapTimer = setTimeout(settleWrap, 750);
  }
  slides.forEach((slide, position) => {
   slide.setAttribute('role', 'group');
   slide.setAttribute('aria-roledescription', 'slide');
   slide.setAttribute('aria-label', `${position + 1} of ${slides.length}: ${slide.querySelector('h3').textContent.trim()}`);
   slide.setAttribute('aria-hidden', String(position !== current));
   slide.inert = position !== current;
   dots.children[position].setAttribute('aria-current', String(position === current));
  });
  if (announce) status.textContent = slides[current].getAttribute('aria-label');
 };
 const schedule = () => {
  clearInterval(timer);
  pauseButton.textContent = playing ? 'Pause slideshow' : 'Play slideshow';
  if (playing && !document.hidden && !carousel.matches(':hover') && !carousel.contains(document.activeElement)) {
   timer = setInterval(() => showSlide(current + 1), 2000);
  }
 };
 const selectSlide = index => {
  playing = false;
  showSlide(index, true);
  schedule();
 };
 slides.forEach((slide, index) => {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = 'carousel-dot';
  dot.setAttribute('aria-label', `Show ${slide.querySelector('h3').textContent.trim()}`);
  dot.setAttribute('aria-controls', 'services-track');
  dot.addEventListener('click', () => selectSlide(index));
  dots.append(dot);
 });
 carousel.querySelector('.carousel-prev').addEventListener('click', () => selectSlide(current - 1));
 carousel.querySelector('.carousel-next').addEventListener('click', () => selectSlide(current + 1));
 pauseButton.addEventListener('click', () => { playing = !playing; schedule(); });
 carousel.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
   event.preventDefault();
   selectSlide(current + (event.key === 'ArrowRight' ? 1 : -1));
  }
 });
 carousel.addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse') pointerStart = { x: event.clientX, y: event.clientY }; });
 carousel.addEventListener('pointerup', event => {
  if (!pointerStart) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) selectSlide(current + (dx < 0 ? 1 : -1));
  pointerStart = undefined;
 });
 carousel.addEventListener('pointercancel', () => { pointerStart = undefined; });
 carousel.addEventListener('mouseenter', schedule);
 carousel.addEventListener('mouseleave', schedule);
 carousel.addEventListener('focusin', schedule);
 carousel.addEventListener('focusout', () => setTimeout(schedule, 0));
 document.addEventListener('visibilitychange', schedule);
 reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) playing = false; schedule(); });
 const followServiceHash = () => {
  const index = slides.findIndex(slide => `#${slide.id}` === window.location.hash);
  if (index >= 0) {
   selectSlide(index);
   carousel.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
 };
 document.querySelectorAll('a[href^="#service-"]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  const hash = link.getAttribute('href');
  history.pushState(null, '', hash);
  followServiceHash();
 }));
 window.addEventListener('hashchange', followServiceHash);
 window.addEventListener('popstate', followServiceHash);
 showSlide(0);
 schedule();
 followServiceHash();
})();
