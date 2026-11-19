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
import * as lesson5 from '../src/lessons/lesson5.mjs';
import * as lesson6 from '../src/lessons/lesson6.mjs';
import * as lesson7 from '../src/lessons/lesson7.mjs';
import * as lesson8 from '../src/lessons/lesson8.mjs';
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
    id, innerHTML: '', textContent: '', hidden: false, dataset: {}, listeners: {}, style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, querySelector() { return null; }, closest() { return null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    getBoundingClientRect() { return { width: 1000, left: 0 }; },
    getContext() { return ctx; },
  });
  let frame = null;
  let now = 1000; // Fake animation time, in ms. Keeps running across runFrames calls.
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
    guess: i => fire('panel', 'click', button({ act: 'guess', guess: String(i) })),
    choosePolicy: value => fire('shop-tags', 'change', { name: 'policy', value }),
    chooseOn: (name, value) => fire('shop-tags', 'change', { name, value }),
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
    // Freeze-frame cards seen, in order. runFrames taps "Got it" like a player would.
    moments: [],
    runFrames(maxFrames, until) {
      for (let i = 0; i < maxFrames; i++) {
        now += 50;
        frame(now);
        if (until()) return i;
        const card = elements.moment;
        if (card && !card.hidden && card.innerHTML && card.innerHTML !== this.lastMoment) {
          this.moments.push(card.innerHTML);
          this.lastMoment = card.innerHTML;
          card.listeners.click.forEach(fn => fn({ target: card }));
        }
      }
      return -1;
    },
    // Frames with no tapping, to hold a freeze-frame card open.
    holdFrames(n) { for (let i = 0; i < n; i++) { now += 50; frame(now); } },
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

test('the debrief receipt prints line by line, counts up, then stamps', () => {
  const page = fakePage();
  const classes = () => { const set = new Set(); return { set, add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), toggle() {}, contains: c => set.has(c) }; };
  const count = () => ({ textContent: '', dataset: { to: '54.8', dp: '1' } });
  const lines = [0, 1].map(() => { const c = count(); return { classList: classes(), count: c, querySelectorAll: () => [c] }; });
  const stamp = { classList: classes() };
  const panel = document.getElementById('panel');
  panel.classList = classes();
  panel.querySelectorAll = sel => (sel === '.tally li' ? lines : []);
  panel.querySelector = sel => (sel === '.stamp' ? stamp : null);
  startGame({ config, lesson: lesson2 });
  page.clickLevel(0);
  page.act('run');
  page.runFrames(5000, () => panel.classList.contains('revealing'));
  assert.equal(lines[0].count.textContent, '0.0', 'numbers start from zero');
  page.runFrames(8, () => false); // About 400 ms in: the first line has printed.
  assert.ok(lines[0].classList.contains('in') && !stamp.classList.contains('in'), 'lines print before the stamp');
  page.runFrames(60, () => !panel.classList.contains('revealing'));
  assert.ok(stamp.classList.contains('in') && panel.classList.contains('jolt'), 'the stamp lands');
  assert.equal(lines[1].count.textContent, '54.8', 'numbers end on the real value');
});

test('live goal meters fill, then flip to AT RISK and MISSED during the rush', () => {
  const page = fakePage();
  const fakeEl = () => ({ style: {}, textContent: '', className: '', dataset: {}, offsetWidth: 0, classList: { add() {}, remove() {}, toggle() {} } });
  const rows = [0, 1].map(() => {
    const parts = { '.meter-fill': fakeEl(), '.live-val': fakeEl(), '.live-badge': fakeEl() };
    return { ...fakeEl(), parts, querySelector: sel => parts[sel] };
  });
  const panel = document.getElementById('panel');
  panel.querySelectorAll = sel => (sel === '.live-goal' ? rows : []);
  startGame({ config, lesson: lesson2 });
  page.clickLevel(1); // 2.2, starting design: the 40-minute goal breaks mid-rush.
  page.act('run');
  const seen = new Set();
  page.runFrames(5000, () => {
    seen.add(rows[1].dataset.status);
    return page.elements.panel.innerHTML.includes('· DEBRIEF');
  });
  assert.ok(seen.has('risk') && seen.has('missed'), `statuses seen: ${[...seen]}`);
  assert.equal(rows[1].parts['.live-badge'].textContent, 'MISSED');
  assert.match(rows[0].parts['.live-val'].textContent, /\/ 50 served/);
  assert.ok(document.getElementById('goal-strip').hidden, 'the strip hides after the rush');
});

test('lesson 2 freeze frames: each shows once, pauses the rush, and can flip the X-ray', () => {
  const page = fakePage();
  const game = startGame({ config, lesson: lesson2 });
  const titles = () => page.moments.map(html => html.match(/<\/span> ([^<]+)<\/p>/)[1]);

  page.clickLevel(0); // 2.1: no rail, so someone walks out.
  page.act('run');
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.deepEqual(titles(), ['Nowhere to wait']);

  page.clickLevel(0); // Replaying in the same visit doesn't pause again.
  page.act('run');
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.equal(page.moments.length, 1);

  // 2.2: the first ticket on the rail pauses the rush and flips on the X-ray.
  page.clickLevel(1);
  page.act('run');
  game.setXray(false);
  page.runFrames(5000, () => !page.elements.moment.hidden && page.elements.moment.innerHTML.includes('First ticket'));
  const clock = page.elements.clock.textContent;
  page.moments.push(page.elements.moment.innerHTML); // runFrames stopped before tapping this one.
  page.lastMoment = page.elements.moment.innerHTML;
  page.holdFrames(40); // Two seconds with the card open.
  assert.equal(game.xray, true, 'the X-ray flipped on for the queue');
  assert.equal(page.elements.clock.textContent, clock, 'the shop clock is paused');
  page.elements.moment.listeners.click.forEach(fn => fn({})); // Got it.
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.deepEqual(titles(), ['Nowhere to wait', 'First ticket on the rail', 'The line is getting long']);
});

test('tapping the receipt skips straight to the stamp', () => {
  const page = fakePage();
  const set = new Set();
  const panel = document.getElementById('panel');
  panel.classList = { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), toggle() {}, contains: c => set.has(c) };
  panel.querySelectorAll = () => [];
  panel.querySelector = () => null;
  startGame({ config, lesson: lesson2 });
  page.clickLevel(0);
  page.act('run');
  page.runFrames(5000, () => set.has('revealing'));
  page.act('anything'); // Any tap on the ticket.
  assert.ok(!set.has('revealing') && set.has('jolt'));
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

test('your call and stars: a right guess and a cheap win earn all three, and the level rail shows them', () => {
  const page = fakePage();
  startGame({ config, lesson: lesson2 });
  const debrief = () => page.elements.panel.innerHTML;
  const earned = html => (html.match(/class="stars debrief-stars"[\s\S]*?<\/ul>/)[0].match(/<li class="on/g) || []).length;

  // 2.1 from the start (no rail): most customers walk out. Call it right.
  page.clickLevel(0);
  assert.ok(page.elements.setup.innerHTML.includes('YOUR CALL'), 'the setup asks for a call');
  page.guess(2); // More than 20.
  page.act('run');
  page.runFrames(5000, () => debrief().includes('· DEBRIEF'));
  assert.ok(debrief().includes('Called it.'), 'the debrief compares the call');
  assert.equal(earned(debrief()), 1, 'only the call star: the goals were missed');
  assert.ok(debrief().includes('NEW'), 'a first star is marked new');

  // Then the cheapest winning design: one barista and the rail, $20. Guess wrong this time.
  page.act('change');
  page.act('minus');
  page.act('rail');
  page.guess(1); // 1 to 20, but nobody walks out.
  page.act('run');
  page.runFrames(5000, () => debrief().includes('· DEBRIEF'));
  assert.ok(debrief().includes('Not this time.'));
  assert.equal(earned(debrief()), 2, 'goals and the $20 stretch');
  assert.match(page.elements.levels.innerHTML, /aria-label="3 of 3 stars"/, 'stars kept across runs show on the level rail');
  assert.ok(!page.elements.levels.innerHTML.match(/data-level="1"[^>]*disabled/), 'level 2.2 unlocked');

  // No call, no call line; and the call is cleared after each rush.
  page.act('change');
  assert.ok(!/data-act="guess"[^>]*aria-pressed="true"/.test(page.elements.panel.innerHTML), 'the call starts fresh');
  page.act('run');
  page.runFrames(5000, () => debrief().includes('· DEBRIEF'));
  assert.ok(!debrief().includes('call-result'));
});

test('lesson 1: the brief opens once per level, and "Reread the brief" brings it back', () => {
  const page = fakePage();
  const game = startGame({ config, lesson: lesson1 });
  assert.deepEqual(game.briefings, ['1.1'], 'the first level briefs on arrival');
  assert.ok(page.elements.panel.innerHTML.includes('Reread the brief'));
  assert.ok(!page.elements.panel.innerHTML.includes(lesson1.LEVELS[0].brief), 'the story lives in the brief, not the ticket');
  page.clickLevel(0);
  assert.deepEqual(game.briefings, ['1.1'], 'coming back to a level skips it');
  page.act('brief');
  assert.deepEqual(game.briefings, ['1.1', '1.1'], 'unless the player asks');
  page.act('async');
  page.act('run');
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.ok(page.elements.panel.innerHTML.includes('Next: 1.2 A fast answer'));
  assert.ok(!page.elements.panel.innerHTML.includes('In software terms'), 'the concept is taught in the brief');
  page.act('next');
  assert.deepEqual(game.briefings, ['1.1', '1.1', '1.2']);
  for (const lv of lesson1.LEVELS) {
    assert.ok(lv.intro.length >= 1 && lv.intro.every(c => c.stub && c.title && c.html.includes('<p>')), `${lv.id}: cards`);
  }
});

test('lesson 1 aha moments: sync and async in 1.1, response and processing time in 1.2', () => {
  const titles = page => page.moments.map(html => html.match(/<\/span> ([^<]+)<\/p>/)[1]);
  const play = (level, choose) => {
    const page = fakePage();
    startGame({ config, lesson: lesson1 });
    playLevel(page, level, choose);
    return titles(page);
  };
  assert.deepEqual(play(0), ['Two baristas, nothing to do']);
  assert.deepEqual(play(0, p => p.act('async')), ["We'll call your name"]);
  assert.deepEqual(play(1), ['Still waiting for an answer']);
  assert.deepEqual(play(1, p => p.act('async')), ['Fast answer, slow drink']);
});

test('lesson 1: the design controls are tags on the shop, and they lock during the rush', () => {
  const page = fakePage();
  startGame({ config, lesson: lesson1 });
  const tags = page.elements['shop-tags'];
  const tap = act => tags.listeners.click.forEach(fn => fn({ target: { closest: () => ({ disabled: false, dataset: { act } }) } }));
  assert.ok(tags.innerHTML.includes('data-act="plus"') && tags.innerHTML.includes('data-act="async"'), 'baristas and call names on the shop');
  assert.ok(!page.elements.panel.innerHTML.includes('Design your shop</h3>'), 'the ticket has no design section');
  tap('async');
  assert.ok(tags.innerHTML.includes('aria-pressed="true"'), 'call names switched on from the shop');
  tap('minus');
  assert.match(tags.innerHTML, /<output aria-live="polite">2<\/output>/);
  const setup = page.elements.setup;
  assert.ok(setup.innerHTML.includes('$38</span> of $80') && setup.innerHTML.includes('data-act="run"'), 'cost and Run sit under the shop');
  assert.ok(setup.innerHTML.includes('YOUR CALL') && !page.elements.panel.innerHTML.includes('YOUR CALL'), 'so does your call');
  assert.ok(!page.elements.panel.innerHTML.includes('data-act="run"'), 'the ticket is the grader');
  page.act('run');
  assert.equal(tags.hidden, true, 'the tags step aside for the rush');
  assert.equal(setup.hidden, true, 'and so does the setup');
  tap('plus'); // Ignored mid-rush.
  assert.match(tags.innerHTML, /<output aria-live="polite">2<\/output>/);
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.ok(page.elements.panel.innerHTML.includes('Goals met'), 'two baristas with call names pass 1.1');
  assert.equal(tags.hidden, false, 'and come back after it');
  tap('plus'); // A tag in the debrief starts the next design.
  assert.ok(page.elements.panel.innerHTML.includes('· BRIEF'));
  assert.match(tags.innerHTML, /<output aria-live="polite">3<\/output>/);
});

test('lesson 1 on a phone: the ticket is a sheet that opens by itself for the debrief', () => {
  const page = fakePage();
  window.matchMedia = q => ({ matches: q.includes('max-width'), addEventListener() {} });
  const game = startGame({ config, lesson: lesson1 });
  assert.equal(page.elements['ticket-btn'].hidden, false, 'the Ticket button shows on phones');
  assert.ok(page.elements.setup.innerHTML.includes('setup-goals'), 'the goals sit above the setup');
  page.act('async');
  page.act('run');
  assert.equal(game.sheetOpens, 0, 'not during the rush');
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.equal(game.sheetOpens, 1, 'the debrief opens full screen');
  page.elements['ticket-btn'].listeners.click.forEach(fn => fn());
  assert.equal(game.sheetOpens, 2, 'and the Ticket button opens it any time');
});

test('on desktop the ticket stays beside the shop', () => {
  const page = fakePage(); // matchMedia matches nothing: a wide screen.
  const game = startGame({ config, lesson: lesson2 });
  assert.equal(page.elements['ticket-btn'].hidden, true, 'no Ticket button on desktop');
  page.act('run');
  page.runFrames(5000, () => page.elements.panel.innerHTML.includes('· DEBRIEF'));
  assert.equal(game.sheetOpens, 0);
});

test('every level of lessons 1-4 has a brief: three cards to open a lesson, then one', () => {
  for (const lesson of [lesson1, lesson2, lesson3, lesson4]) {
    lesson.LEVELS.forEach((lv, i) => {
      assert.ok(Array.isArray(lv.intro), `${lv.id}: has a brief`);
      assert.equal(lv.intro.length, i === 0 ? 3 : 1, `${lv.id}: card count`);
      for (const c of lv.intro) assert.ok(c.stub && c.title && c.html.includes('<p>'), `${lv.id}: card parts`);
    });
    const ids = (lesson.MOMENTS || []).map(m => m.id);
    assert.equal(new Set(ids).size, ids.length, 'moment ids are unique');
  }
});

test('lesson 3 and 4 aha moments fire for the designs they explain', () => {
  const titles = page => page.moments.map(html => html.match(/<\/span> ([^<]+)<\/p>/)[1]);
  const play = (lesson, level, choose) => {
    const page = fakePage();
    startGame({ config, lesson });
    playLevel(page, level, choose);
    return titles(page);
  };
  assert.deepEqual(play(lesson3, 0, p => p.choosePolicy('fifo')), ['An order from the app', 'Walk-ins stuck in line']);
  assert.deepEqual(play(lesson3, 0, p => p.choosePolicy('walkin')), ['An order from the app']);
  assert.deepEqual(play(lesson3, 1), ['The app rail is starving']);
  assert.deepEqual(play(lesson4, 0), ['One pitcher per latte']);
  assert.deepEqual(play(lesson4, 0, p => p.act('batch')), ['Two lattes, one pitcher']);
  assert.deepEqual(play(lesson4, 1, p => p.setBatchWait(3)), ['Waiting for a second latte']);
  assert.deepEqual(play(lesson4, 2), ['App orders running late']);
});

test('every lesson shows its levers as tags on the shop', () => {
  const expect = {
    '2.1': ['baristas', 'rail'], '2.3': ['baristas', 'rail', 'capacity'],
    '3.2': ['baristas', 'policy'], '4.2': ['crew', 'batchWait'], '4.3': ['baristas', 'policy', 'batch'],
  };
  for (const lesson of [lesson2, lesson3, lesson4]) {
    const page = fakePage();
    startGame({ config, lesson });
    lesson.LEVELS.forEach((lv, i) => {
      page.clickLevel(i);
      const ctls = [...page.elements['shop-tags'].innerHTML.matchAll(/data-ctl="(\w+)"/g)].map(m => m[1]);
      if (expect[lv.id]) assert.deepEqual(ctls, expect[lv.id], lv.id);
      assert.ok(!page.elements.panel.innerHTML.includes('Design your shop</h3>'), `${lv.id}: no design section in the ticket`);
    });
  }
  const page = fakePage();
  startGame({ config, lesson: lesson3 });
  page.clickLevel(1);
  page.choosePolicy('weighted');
  assert.ok(page.elements['shop-tags'].innerHTML.includes('data-ctl="every"'), 'fair share adds the every-Nth tag');
});

test('Group B: every level of lessons 5-8 plays to a debrief, from the start and a winning design', () => {
  const times = (p, act, n) => { for (let i = 0; i < n; i++) p.act(act); };
  // How to win each level with only that level's own tags.
  const winning = {
    '5.1': { changes: p => { p.act('autoscale'); p.act('minus'); }, design: { autoscale: true, baristas: 1 } },
    '5.2': { changes: p => { p.act('plus'); times(p, 'scale-minus', 2); }, design: { baristas: 2, scaleAt: 1 } },
    '5.3': { changes: p => times(p, 'cool-plus', 3), design: { cooldown: 180 } },
    '6.1': { changes: p => p.chooseOn('boxRule', 'none'), design: { boxRule: 'none' } },
    '6.2': { changes: p => p.chooseOn('boxRule', 'bucket'), design: { boxRule: 'bucket' } },
    '7.1': { changes: p => p.act('pause'), design: { pause: true } },
    '7.2': { changes: p => times(p, 'pause-plus', 6), design: { pauseAt: 10 } },
    '8.1': { changes: p => p.act('case'), design: { caseSize: 12 } },
    '8.2': { changes: p => times(p, 'case-plus', 4), design: { caseSize: 16 } },
  };
  for (const lesson of [lesson5, lesson6, lesson7, lesson8]) {
    for (const [i, level] of lesson.LEVELS.entries()) {
      for (const variant of ['start', 'winning']) {
        const page = fakePage();
        startGame({ config, lesson });
        const w = winning[level.id];
        const html = playLevel(page, i, variant === 'winning' ? w.changes : undefined);
        const design = variant === 'winning' ? { ...level.start, ...w.design } : level.start;
        const passed = lesson.evaluate(level, design, summarize(run(design, { rush: level.rush }))).passed;
        assert.equal(verdict(html), passed ? 'pass' : 'fail', `level ${level.id}, ${variant}`);
        assert.equal(passed, variant === 'winning', `level ${level.id}: the ${variant} design should ${variant === 'winning' ? 'pass' : 'fail'}`);
      }
    }
  }
});

test('Group B: briefs, moments, and the tags each level shows', () => {
  const expect = {
    '5.1': ['baristas', 'autoscale'], '5.3': ['crew', 'cooldown'], '6.1': ['crew', 'boxRule'], '7.2': ['crew', 'pause', 'pauseAt'], '8.2': ['crew', 'caseSize'],
  };
  for (const lesson of [lesson5, lesson6, lesson7, lesson8]) {
    const ids = lesson.MOMENTS.map(m => m.id);
    assert.equal(new Set(ids).size, ids.length, 'moment ids are unique');
    const page = fakePage();
    startGame({ config, lesson });
    lesson.LEVELS.forEach((lv, i) => {
      assert.equal(lv.intro.length, i === 0 ? 3 : 1, `${lv.id}: brief cards`);
      page.clickLevel(i);
      const ctls = [...page.elements['shop-tags'].innerHTML.matchAll(/data-ctl="(\w+)"/g)].map(m => m[1]);
      if (expect[lv.id]) assert.deepEqual(ctls, expect[lv.id], lv.id);
    });
  }
  // Lesson 5 is paid by the minute: no budget anywhere.
  const page = fakePage();
  startGame({ config, lesson: lesson5 });
  assert.ok(page.elements.panel.innerHTML.includes('PAID BY THE MINUTE') && !page.elements.panel.innerHTML.includes('$Infinity'));
  assert.ok(page.elements.setup.innerHTML.includes('by the minute'));
});
