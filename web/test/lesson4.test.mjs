// Lesson 4's levels must stay winnable, and each must force the trade-off it teaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/engine.mjs';
import { LEVELS, evaluate, designCost } from '../src/lessons/lesson4.mjs';
import { run } from './helpers.mjs';

const [steam, window, appRush] = LEVELS;
const MARGIN = 1.5;
const play = (level, d) => {
  const s = summarize(run(d, { rush: level.rush }));
  return { ...evaluate(level, d, s), s };
};
const at = (level, overrides) => ({ ...level.start, ...overrides });

test('every level starts in a design that fails', () => {
  for (const level of LEVELS) assert.equal(play(level, level.start).passed, false, `level ${level.id}`);
});

test('4.1: two baristas fail without batching and pass clearly with it', () => {
  const off = play(steam, at(steam, { batch: false }));
  const on = play(steam, at(steam, { batch: true }));
  assert.ok(off.s.longestWaitMin >= 20 + MARGIN, `without batching: ${off.s.longestWaitMin}`);
  assert.ok(on.passed && on.s.longestWaitMin <= 20 - MARGIN, `with batching: ${on.s.longestWaitMin}`);
});

test('4.1: a third barista is over budget, and one barista fails even with batching', () => {
  assert.ok(designCost({ baristas: 3, rail: true }) > steam.budget);
  assert.equal(play(steam, at(steam, { baristas: 1, batch: true })).passed, false);
});

test('4.2: a short batch window passes; none or too long fails', () => {
  const result = minutes => play(window, at(window, { batchWait: minutes * 60 })).passed;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].filter(result), [2, 3, 4]);
});

test('4.2: no window uses too many pitchers; a long window makes people wait', () => {
  assert.ok(play(window, at(window, { batchWait: 0 })).s.steams > 9);
  assert.ok(play(window, at(window, { batchWait: 6 * 60 })).s.longestWaitMin > 8);
});

test('4.2: the crew is fixed, so the only lever is the batch window', () => {
  assert.deepEqual(window.controls, ['batchWait']);
});

test('4.3: no lesson 3 rule is enough without batching', () => {
  const rules = [{ policy: 'fifo' }, { policy: 'walkin' }, { policy: 'mobile' }, ...[2, 3, 4, 5, 6].map(n => ({ policy: 'weighted', mobileEvery: n }))];
  for (const rule of rules) {
    const r = play(appRush, at(appRush, { ...rule, batch: false }));
    const missedBy = Math.max(r.s.walkin.longestWaitMin - 15, r.s.mobile.longestWaitMin - 10);
    assert.ok(missedBy >= MARGIN, `${JSON.stringify(rule)} misses by only ${missedBy.toFixed(1)} min`);
  }
});

test('4.3: batching with a fair rule passes clearly', () => {
  for (const rule of [{ policy: 'fifo' }, { policy: 'weighted', mobileEvery: 3 }]) {
    const r = play(appRush, at(appRush, { ...rule, batch: true }));
    assert.ok(r.passed, JSON.stringify(rule));
    assert.ok(r.s.walkin.longestWaitMin <= 15 - MARGIN && r.s.mobile.longestWaitMin <= 10 - MARGIN, JSON.stringify(rule));
  }
});

test('4.3: batching with strict walk-ins first still starves app orders', () => {
  const r = play(appRush, at(appRush, { policy: 'walkin', batch: true }));
  assert.equal(r.passed, false);
  assert.ok(r.s.walkin.longestWaitMin <= 15, 'walk-ins are fine');
  assert.ok(r.s.mobile.longestWaitMin >= 10 + MARGIN, `app orders ${r.s.mobile.longestWaitMin}`);
});

test('4.3: four baristas are over budget', () => {
  assert.ok(designCost({ baristas: 4, rail: true }) > appRush.budget);
});
