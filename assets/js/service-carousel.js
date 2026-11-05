// Service slideshow: keyboard/touch controls, pause behavior, and reduced motion.
(() => {
  'use strict';
  const carousel = document.querySelector('.service-carousel');
  // This script belongs to the homepage. Return quietly if a future page does
  // not include the carousel instead of stopping every other page script.
  if (!carousel) return;
  const track = carousel.querySelector('.services-grid');
  const dots = carousel.querySelector('.carousel-dots');
  const pauseButton = carousel.querySelector('.carousel-pause');
  const status = carousel.querySelector('.carousel-status');
  const previousButton = carousel.querySelector('.carousel-prev');
  const nextButton = carousel.querySelector('.carousel-next');
  if (!track || !dots || !pauseButton || !status || !previousButton || !nextButton) return;
  const slides = [...track.querySelectorAll('.service-card')];
  if (!slides.length) return;
  const boundaryCopy = (slide) => {
    const copy = slide.cloneNode(true);
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    copy.dataset.carouselClone = 'true';
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    copy.querySelector('img').loading = 'eager';
    return copy;
  };
  track.prepend(boundaryCopy(slides[slides.length - 1]));
  track.append(boundaryCopy(slides[0]));
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
  track.addEventListener('transitionend', (event) => {
    if (event.target === track && event.propertyName === 'transform' && wrapping) settleWrap();
  });
  const showSlide = (index, announce = false) => {
    if (wrapping) settleWrap();
    const previous = current;
    current = (index + slides.length) % slides.length;
    let position = current + 1;
    if (previous === slides.length - 1 && current === 0) {
      position = slides.length + 1;
      wrapping = true;
    }
    if (previous === 0 && current === slides.length - 1) {
      position = 0;
      wrapping = true;
    }
    // Fetch the active image and its successor before automatic rotation needs it.
    [current, (current + 1) % slides.length].forEach((position) => {
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
      slide.setAttribute(
        'aria-label',
        `${position + 1} of ${slides.length}: ${slide.querySelector('h3').textContent.trim()}`
      );
      slide.setAttribute('aria-hidden', String(position !== current));
      slide.inert = position !== current;
      dots.children[position].setAttribute('aria-current', String(position === current));
    });
    if (announce) status.textContent = slides[current].getAttribute('aria-label');
  };
  const schedule = () => {
    clearInterval(timer);
    pauseButton.textContent = playing ? 'Pause slideshow' : 'Play slideshow';
    if (
      playing &&
      !document.hidden &&
      !carousel.matches(':hover') &&
      !carousel.contains(document.activeElement)
    ) {
      timer = setInterval(() => showSlide(current + 1), 2000);
    }
  };
  const selectSlide = (index) => {
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
  previousButton.addEventListener('click', () => selectSlide(current - 1));
  nextButton.addEventListener('click', () => selectSlide(current + 1));
  pauseButton.addEventListener('click', () => {
    playing = !playing;
    schedule();
  });
  carousel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      selectSlide(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  carousel.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') pointerStart = { x: event.clientX, y: event.clientY };
  });
  carousel.addEventListener('pointerup', (event) => {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) selectSlide(current + (dx < 0 ? 1 : -1));
    pointerStart = undefined;
  });
  carousel.addEventListener('pointercancel', () => {
    pointerStart = undefined;
  });
  carousel.addEventListener('mouseenter', schedule);
  carousel.addEventListener('mouseleave', schedule);
  carousel.addEventListener('focusin', schedule);
  carousel.addEventListener('focusout', () => setTimeout(schedule, 0));
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) playing = false;
    schedule();
  });
  const followServiceHash = () => {
    const index = slides.findIndex((slide) => `#${slide.id}` === window.location.hash);
    if (index >= 0) {
      selectSlide(index);
      carousel.scrollIntoView({
        block: 'start',
        behavior: reducedMotion.matches ? 'instant' : 'smooth',
      });
    }
  };
  document.querySelectorAll('a[href^="#service-"]').forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const hash = link.getAttribute('href');
      history.pushState(null, '', hash);
      followServiceHash();
    })
  );
  window.addEventListener('hashchange', followServiceHash);
  window.addEventListener('popstate', followServiceHash);
  // Announce the first slide as well as later user-selected slides.
  showSlide(0, true);
  schedule();
  followServiceHash();
})();
