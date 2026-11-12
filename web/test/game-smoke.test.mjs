// Plays every level of the real game module in Node, with stand-ins for the page
// and canvas. It can't check how things look, but it catches runtime errors and
// checks that the debrief's verdict matches the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from '../src/game/shop-game.mjs';
import { summarize } from '../src/engine.mjs';
import * as lesson1 from '../src/lessons/lesson1.mjs';
import * as lesson2 from '../src/lessons/lesson2.mjs';
import * as lesson3 from '../src/lessons/lesson3.mjs';
import * as lesson4 from '../src/lessons/lesson4.mjs';
import { config, run } from './helpers.mjs';

// A 2D context that accepts every call and returns harmless values.
function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'measureText') return () => ({ width: 40 });
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; },
    has() { return false; },
  });
}

// only: if given, the page has just these element ids (like the homepage demo).
function fakePage({ only } = {}) {
  const ctx = fakeContext();
  const elements = {};
  const make = id => ({
    id, innerHTML: '', textContent: '', hidden: false, dataset: {}, listeners: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, querySelector() { return null; }, closest() { return null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    getBoundingClientRect() { return { width: 1000, left: 0 }; },
    getContext() { return ctx; },
  });
  let frame = null;
  globalThis.document = {
    getElementById: id => (only && !only.includes(id) ? null : (elements[id] ||= make(id))),
    // Canvases for the drawing layers; anything else is a stand-in element, as in a browser.
    createElement: tag => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx } : make(tag)),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  globalThis.window = { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = fn => { frame = fn; };
  const fire = (id, type, target) => elements[id].listeners[type].forEach(fn => fn({ target }));
  const button = dataset => ({ closest: () => ({ disabled: false, dataset }) });
  return {
    elements,
    clickLevel: i => fire('levels', 'click', button({ level: String(i) })),
    act: name => fire('panel', 'click', button({ act: name })),
    choosePolicy: value => fire('panel', 'change', { name: 'policy', value }),
    // Steppers: step all the way down, then up to the value.
    setEvery: n => {
      for (let i = 0; i < 6; i++) fire('panel', 'click', button({ act: 'every-minus' }));
      for (let i = 2; i < n; i++) fire('panel', 'click', button({ act: 'every-plus' }));
    },
    setBatchWait: minutes => {
      for (let i = 0; i < 6; i++) fire('panel', 'click', button({ act: 'wait-minus' }));
      for (let i = 0; i < minutes; i++) fire('panel', 'click', button({ act: 'wait-plus' }));
    },
    toggleXray: () => elements.xrayBtn.listeners.click.forEach(fn => fn()),
    runFrames(maxFrames, until) {
      let now = 1000;
      for (let i = 0; i < maxFrames; i++) {
        now += 50;
        frame(now);
        if (until()) return i;
      }
      return -1;
    },
  };
}

function playLevel(page, i, choose) {
  page.clickLevel(i);
  if (choose) choose(page);
  page.act('run');
  page.runFrames(200, () => false); // Shop view for a while.
  page.toggleXray(); // Then the X-ray, mid-rush.
  const frames = page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.ok(frames >= 0, `level ${i + 1}: the rush never finished`);
  page.toggleXray();
  return page.elements.panel.innerHTML;
}

const verdict = html => (html.includes('Goals met') ? 'pass' : html.includes('Not yet') ? 'fail' : 'unknown');

test('every lesson 2 level plays to a debrief, and the verdict matches the engine', () => {
  const page = fakePage();
  startGame({ config, lesson: lesson2 });
  lesson2.LEVELS.forEach((level, i) => {
    const html = playLevel(page, i);
    const expected = lesson2.evaluate(level, level.start, summarize(run(level.start, { rush: level.rush }))).passed;
    assert.equal(verdict(html), expected ? 'pass' : 'fail', `level ${level.id}`);
  });
});

test('the homepage demo runs with only the shop window on the page, and loops', () => {
  const page = fakePage({ only: ['scene', 'shop', 'clock', 'xrayBtn', 'caption'] });
  let finished = 0;
  const demo = startGame({ config, lesson: lesson4, onFinish: () => { finished++; } });
  demo.play(2, { policy: 'weighted', mobileEvery: 3, batch: true });
  assert.ok(page.runFrames(6000, () => finished === 1) >= 0, 'the first demo rush never finished');
  demo.setXray(true);
  assert.equal(demo.xray, true);
  demo.play(2, { policy: 'weighted', mobileEvery: 3, batch: true });
  assert.ok(page.runFrames(6000, () => finished === 2) >= 0, 'the demo did not loop');
  assert.ok(page.elements.caption.innerHTML.includes('Rush over'), 'the caption reports the rush');
});

test('a folded-away level ticket reopens for the debrief and the next brief', () => {
  const page = fakePage();
  const holder = { open: true }; // The <details> the panel sits in on lesson pages.
  document.getElementById('panel').closest = sel => (sel === 'details' ? holder : null);
  startGame({ config, lesson: lesson2 });
  page.clickLevel(0);
  page.act('run');
  holder.open = false; // The player folds the ticket away during the rush.
  page.runFrames(10, () => false);
  assert.ok(!page.elements.panel.innerHTML.includes('· DEBRIEF'), 'still mid-rush');
  assert.equal(holder.open, false, 'the rush should not reopen it');
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.equal(holder.open, true, 'the debrief reopens it');
});

test('the last level links to the next lesson', () => {
  const page = fakePage();
  startGame({ config, lesson: lesson1, next: { href: 'order-line.html', title: 'The order line' } });
  const html = playLevel(page, 1, p => { p.act('async'); p.act('plus'); });
  assert.ok(html.includes('href="order-line.html"') && html.includes('Next lesson: The order line'));
});

test('every lesson 1 level plays to a debrief, from the starting design and a winning one', () => {
  const winning = {
    '1.1': { changes: p => p.act('async'), design: { sync: false } },
    '1.2': { changes: p => { p.act('async'); p.act('plus'); }, design: { sync: false, baristas: 3 } },
  };
  for (const [i, level] of lesson1.LEVELS.entries()) {
    for (const variant of ['start', 'winning']) {
      const page = fakePage();
      startGame({ config, lesson: lesson1 });
      const w = winning[level.id];
      const html = playLevel(page, i, variant === 'winning' ? w.changes : undefined);
      const design = variant === 'winning' ? { ...level.start, ...w.design } : level.start;
      const expected = lesson1.evaluate(level, design, summarize(run(design, { rush: level.rush }))).passed;
      assert.equal(verdict(html), expected ? 'pass' : 'fail', `level ${level.id}, ${variant}`);
      if (variant === 'winning') assert.equal(expected, true, `level ${level.id}: the winning design should pass`);
      assert.ok(html.includes('time to an answer'), `level ${level.id}: debrief reports time to an answer`);
    }
  }
});

test('every lesson 4 level plays to a debrief, from the starting design and a winning one', () => {
  // How to reach a winning design in each level, using only the level's own controls.
  const winning = {
    '4.1': { changes: p => p.act('batch'), design: { batch: true } },
    '4.2': { changes: p => p.setBatchWait(3), design: { batchWait: 180 } },
    '4.3': { changes: p => { p.act('batch'); p.choosePolicy('fifo'); }, design: { batch: true, policy: 'fifo' } },
  };
  for (const [i, level] of lesson4.LEVELS.entries()) {
    for (const variant of ['start', 'winning']) {
      const page = fakePage();
      startGame({ config, lesson: lesson4 });
      const w = winning[level.id];
      const html = playLevel(page, i, variant === 'winning' ? w.changes : undefined);
      const design = variant === 'winning' ? { ...level.start, ...w.design } : level.start;
      const expected = lesson4.evaluate(level, design, summarize(run(design, { rush: level.rush }))).passed;
      assert.equal(verdict(html), expected ? 'pass' : 'fail', `level ${level.id}, ${variant}`);
      if (variant === 'winning') assert.equal(expected, true, `level ${level.id}: the winning design should pass`);
      assert.ok(html.includes('Pitchers steamed'), `level ${level.id}: debrief reports pitchers`);
    }
  }
});

test('every lesson 3 level plays to a debrief with each rule it offers', () => {
  for (const [i, level] of lesson3.LEVELS.entries()) {
    for (const policy of level.policies) {
      const page = fakePage();
      startGame({ config, lesson: lesson3 });
      const html = playLevel(page, i, p => {
        p.choosePolicy(policy);
        if (policy === 'weighted') p.setEvery(5);
      });
      const design = { ...level.start, policy, mobileEvery: policy === 'weighted' ? 5 : level.start.mobileEvery };
      const expected = lesson3.evaluate(level, design, summarize(run(design, { rush: level.rush }))).passed;
      assert.equal(verdict(html), expected ? 'pass' : 'fail', `level ${level.id}, ${policy}`);
      assert.ok(html.includes('walk-in') && html.includes('app'), 'debrief reports both channels');
    }
  }
});
