// Stars and predictions, checked against the engine across every design a player can build.
// Each level's stretch star must be earnable within budget, real stretches must not come for
// free with a pass, and every prediction must have exactly one answer for any design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/engine.mjs';
import { starsFor, outcome, designCost, evaluate } from '../src/lessons/common.mjs';
import * as lesson1 from '../src/lessons/lesson1.mjs';
import * as lesson2 from '../src/lessons/lesson2.mjs';
import * as lesson3 from '../src/lessons/lesson3.mjs';
import * as lesson4 from '../src/lessons/lesson4.mjs';
import * as lesson5 from '../src/lessons/lesson5.mjs';
import * as lesson6 from '../src/lessons/lesson6.mjs';
import * as lesson7 from '../src/lessons/lesson7.mjs';
import * as lesson8 from '../src/lessons/lesson8.mjs';
import { run } from './helpers.mjs';

const LEVELS = [lesson1, lesson2, lesson3, lesson4, lesson5, lesson6, lesson7, lesson8].flatMap(l => l.LEVELS);

// Every design the level's controls allow (barista counts 1-4), within budget.
function designs(lv) {
  const out = [];
  for (const baristas of [1, 2, 3, 4]) {
    const base = { ...lv.start, baristas };
    if (lv.controls && !lv.controls.includes('baristas') && baristas !== lv.start.baristas) continue;
    if (lv.id.startsWith('1')) out.push({ ...base, sync: true }, { ...base, sync: false });
    else if (lv.id === '2.1' || lv.id === '2.2') out.push({ ...base, rail: false }, { ...base, rail: true });
    else if (lv.id === '2.3') for (const capacity of [5, 10, 15, 20, 25, 30, 40, 50]) out.push({ ...base, capacity });
    else if (lv.id.startsWith('3')) for (const policy of lv.policies) for (const mobileEvery of [2, 3, 4, 5, 6]) out.push({ ...base, policy, mobileEvery });
    else if (lv.id === '4.1') out.push({ ...base, batch: false }, { ...base, batch: true });
    else if (lv.id === '4.2') for (const w of [0, 1, 2, 3, 4, 5, 6]) out.push({ ...base, batchWait: w * 60 });
    else if (lv.id === '4.3') for (const policy of lv.policies) for (const batch of [false, true]) out.push({ ...base, policy, batch, mobileEvery: 3 });
    // Group B: the levers each level shows.
    else if (lv.id === '5.1') { out.push({ ...base, autoscale: false }, { ...base, autoscale: true }); }
    else if (lv.id === '5.2') for (const scaleAt of [1, 2, 3, 4, 6]) out.push({ ...base, scaleAt });
    else if (lv.id === '5.3') { if (baristas === lv.start.baristas) for (const cooldown of [0, 60, 120, 180, 240, 300, 420, 600]) out.push({ ...base, cooldown }); }
    else if (lv.id.startsWith('6')) { if (baristas === lv.start.baristas) for (const boxRule of lv.boxRules) for (const boxEvery of [180, 300, 420, 600, 900]) out.push({ ...base, boxRule, boxEvery }); }
    else if (lv.id.startsWith('7')) { if (baristas === lv.start.baristas) { out.push({ ...base, pause: false }); for (let pauseAt = 3; pauseAt <= 20; pauseAt++) out.push({ ...base, pause: true, pauseAt }); } }
    else if (lv.id === '8.1') { for (const caseSize of [0, 12]) out.push({ ...base, caseSize }); }
    else if (lv.id === '8.2') { if (baristas === lv.start.baristas) for (let caseSize = 2; caseSize <= 20; caseSize += 2) out.push({ ...base, caseSize }); }
  }
  return out.filter(d => designCost(d) <= lv.budget).map(d => ({ d, s: summarize(run(d, { rush: lv.rush })) }));
}

const all = LEVELS.map(lv => ({ lv, runs: designs(lv) }));

test('every level has a prediction and a stretch star', () => {
  for (const { lv } of all) {
    assert.ok(lv.predict && lv.predict.options.length >= 2, `${lv.id}: prediction`);
    assert.ok(lv.stretch && lv.stretch.label, `${lv.id}: stretch`);
    assert.ok(lv.predict.q(lv.start).endsWith('?'), `${lv.id}: the call is a question`);
  }
});

test('every prediction has an answer for every design, and more than one answer happens', () => {
  for (const { lv, runs } of all) {
    const seen = new Set();
    for (const { d, s } of runs) {
      const i = outcome(lv.predict, s, d);
      assert.ok(i >= 0, `${lv.id}: no option matched`);
      assert.ok(lv.predict.actual(s, d).length > 0);
      seen.add(i);
    }
    assert.ok(seen.size >= 2, `${lv.id}: the answer never changes (${[...seen]})`);
  }
});

test('every stretch star can be earned with a design inside the budget', () => {
  for (const { lv, runs } of all) {
    const earned = runs.some(({ d, s }) => starsFor(lv, d, s, { rushes: 1 })[1]);
    assert.ok(earned, `${lv.id}: no design earns "${lv.stretch.label}"`);
  }
});

test('stretch stars ask for more than a pass, where the level has room for it', () => {
  // Levels whose stretch isn't "in 3 rushes or fewer": some passing design must miss it.
  for (const { lv, runs } of all.filter(x => !x.lv.stretch.label.includes('rushes'))) {
    const passing = runs.filter(({ d, s }) => evaluate(lv, d, s).passed);
    assert.ok(passing.some(({ d, s }) => !starsFor(lv, d, s)[1]), `${lv.id}: "${lv.stretch.label}" comes free with every pass`);
  }
});

test('stars: goals, stretch, and called it', () => {
  const lv = lesson2.LEVELS[0]; // 2.1: stretch is $20 or less.
  const cheap = { ...lv.start, baristas: 1, rail: true };
  const s = summarize(run(cheap, { rush: lv.rush }));
  const right = outcome(lv.predict, s, cheap);
  assert.deepEqual(starsFor(lv, cheap, s, { guess: right }), [true, true, true]);
  assert.deepEqual(starsFor(lv, cheap, s, { guess: (right + 1) % 3 }), [true, true, false]);
  assert.deepEqual(starsFor(lv, cheap, s, { guess: null }), [true, true, false]);
  const noRail = summarize(run(lv.start, { rush: lv.rush }));
  const [met, stretch] = starsFor(lv, lv.start, noRail, {});
  assert.equal(met, false);
  assert.equal(stretch, false, 'no stretch star without meeting the goals');
  const slow = lesson2.LEVELS[1];
  const win = { ...slow.start, baristas: 3 };
  const ws = summarize(run(win, { rush: slow.rush }));
  assert.equal(starsFor(slow, win, ws, { rushes: 3 })[1], true);
  assert.equal(starsFor(slow, win, ws, { rushes: 4 })[1], false, 'four rushes is too many');
});
