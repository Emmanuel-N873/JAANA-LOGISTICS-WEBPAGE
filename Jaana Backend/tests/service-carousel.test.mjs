import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../assets/js/service-carousel.js', import.meta.url),
  'utf8'
);

function slideshow(reduceMotion = false) {
  class Element {
    constructor() {
      this.events = {};
      this.attributes = {};
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.inert = false;
    }
    addEventListener(name, callback) {
      (this.events[name] ??= []).push(callback);
    }
    fire(name, event = {}) {
      for (const callback of this.events[name] || [])
        callback({ target: this, preventDefault() {}, ...event });
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    getAttribute(name) {
      return this.attributes[name];
    }
    removeAttribute(name) {
      delete this.attributes[name];
    }
    append(child) {
      this.children.push(child);
    }
    prepend(child) {
      this.children.unshift(child);
    }
    querySelectorAll(selector) {
      if (selector === '.service-photo') return [this.photo];
      return [];
    }
    contains() {
      return false;
    }
    matches() {
      return false;
    }
    scrollIntoView() {}
  }
  function slide(id) {
    const element = new Element();
    const image = { loading: 'lazy' };
    element.photo = image;
    element.id = id;
    element.querySelector = (selector) => (selector === 'h3' ? { textContent: id } : image);
    element.cloneNode = () => slide(id);
    return element;
  }
  const slides = [
    'service-documents',
    'service-commerce',
    'service-food',
    'service-bulk',
    'service-custom',
  ].map(slide);
  const track = new Element();
  track.children = [...slides];
  track.querySelectorAll = () => slides;
  const selectors = Object.fromEntries(
    [
      '.carousel-dots',
      '.carousel-pause',
      '.carousel-status',
      '.carousel-prev',
      '.carousel-next',
    ].map((selector) => [selector, new Element()])
  );
  selectors['.services-grid'] = track;
  const carousel = new Element();
  carousel.querySelector = (selector) => selectors[selector];
  const links = slides.map((slide) => {
    const link = new Element();
    link.getAttribute = () => `#${slide.id}`;
    return link;
  });
  const intervals = new Map();
  let timerId = 0;
  const motion = { matches: reduceMotion, addEventListener() {} };
  const windowEvents = {};
  const window = {
    location: { hash: '' },
    matchMedia: () => motion,
    addEventListener(name, callback) {
      (windowEvents[name] ??= []).push(callback);
    },
  };
  const documentEvents = {};
  const document = {
    hidden: false,
    activeElement: null,
    querySelector: () => carousel,
    querySelectorAll: (selector) => (selector === 'a[href^="#service-"]' ? links : []),
    createElement: () => new Element(),
    addEventListener(name, callback) {
      (documentEvents[name] ??= []).push(callback);
    },
  };
  const history = {
    pushState(_state, _title, hash) {
      window.location.hash = hash;
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    history,
    setInterval: (callback) => {
      intervals.set(++timerId, callback);
      return timerId;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: () => ++timerId,
    clearTimeout() {},
  });
  return { slides, track, selectors, carousel, intervals, links, window, windowEvents };
}

test('service slideshow preserves cloning, accessible controls, navigation and pause behavior', () => {
  const view = slideshow();
  assert.equal(view.track.children.length, 7);
  assert.equal(view.slides[0].inert, false);
  assert.equal(view.slides[1].inert, true);
  assert.equal(view.selectors['.carousel-dots'].children.length, 5);
  assert.equal(view.intervals.size, 1);
  assert.match(view.selectors['.carousel-status'].textContent, /1 of 5/);
  view.selectors['.carousel-next'].fire('click');
  assert.equal(view.slides[1].inert, false);
  assert.equal(view.slides[0].inert, true);
  assert.equal(view.intervals.size, 0);
  view.carousel.fire('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 10 });
  view.carousel.fire('pointerup', { pointerType: 'touch', clientX: 30, clientY: 10 });
  assert.equal(view.slides[2].inert, false);
  assert.equal(view.slides[1].inert, true);
  view.carousel.fire('keydown', { key: 'ArrowRight' });
  assert.equal(view.slides[3].inert, false);
  view.links[4].fire('click');
  assert.equal(view.slides[4].inert, false);
  assert.equal(view.window.location.hash, '#service-custom');
  assert.match(view.selectors['.carousel-status'].textContent, /5 of 5/);
});

test('service slideshow starts paused when reduced motion is requested', () => {
  const view = slideshow(true);
  assert.equal(view.intervals.size, 0);
  assert.equal(view.selectors['.carousel-pause'].textContent, 'Play slideshow');
});
