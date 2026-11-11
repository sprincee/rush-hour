// Plays every level of the real game module in Node, with stand-ins for the page
// and canvas. It can't check how things look, but it catches runtime errors and
// checks that the debrief's verdict matches the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGame } from '../src/game/shop-game.mjs';
import { summarize } from '../src/engine.mjs';
import * as lesson2 from '../src/lessons/lesson2.mjs';
import * as lesson3 from '../src/lessons/lesson3.mjs';
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

function fakePage() {
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
    getElementById: id => (elements[id] ||= make(id)),
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
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
    setEvery: n => fire('panel', 'input', { id: 'mobileEvery', value: String(n) }),
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
  const frames = page.runFrames(5000, () => page.elements.panel.innerHTML.includes('Debrief'));
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
