// Lesson 3's levels must stay winnable, and each must force the trade-off it teaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/engine.mjs';
import { LEVELS, evaluate, designCost } from '../src/lessons/lesson3.mjs';
import { run } from './helpers.mjs';

const [level1, level2] = LEVELS;
const MARGIN = 1.5; // Minutes a passing design must beat each goal by, so it never feels like luck.
const design = (overrides) => ({ baristas: 3, rail: true, capacity: Infinity, policy: 'fifo', mobileEvery: 3, ...overrides });
const play = (level, d) => {
  const s = summarize(run(d, { rush: level.rush }));
  return { ...evaluate(level, d, s), s };
};
const clearPass = s => s.walkin.longestWaitMin <= 15 - MARGIN && s.mobile.longestWaitMin <= 30 - MARGIN;

test('every level starts in a design that fails', () => {
  for (const level of LEVELS) assert.equal(play(level, level.start).passed, false, `level ${level.id}`);
});

test('every policy a level offers exists, and the starting policy is one of them', () => {
  for (const level of LEVELS) assert.ok(level.policies.includes(level.start.policy), level.id);
});

test('4 baristas are over budget, so the rule has to do the work', () => {
  for (const level of LEVELS) assert.ok(designCost(design({ baristas: 4 })) > level.budget, level.id);
});

test('3.1: oldest-first makes walk-ins wait too long', () => {
  const r = play(level1, design({ policy: 'fifo' }));
  assert.equal(r.passed, false);
  assert.ok(r.s.walkin.longestWaitMin > 15, `walk-ins ${r.s.walkin.longestWaitMin}`);
});

test('3.1: walk-ins first passes clearly', () => {
  const r = play(level1, design({ policy: 'walkin' }));
  assert.equal(r.passed, true);
  assert.ok(clearPass(r.s), JSON.stringify(r.s.walkin) + JSON.stringify(r.s.mobile));
});

test('3.1: app orders first fails walk-ins', () => {
  assert.equal(play(level1, design({ policy: 'mobile' })).passed, false);
});

test('3.2: walk-ins first now starves the app rail', () => {
  const r = play(level2, design({ policy: 'walkin' }));
  assert.equal(r.passed, false);
  assert.ok(r.s.walkin.longestWaitMin <= 15, 'walk-ins are fine');
  assert.ok(r.s.mobile.longestWaitMin > 30 + 2, `app orders ${r.s.mobile.longestWaitMin} min`);
});

test('3.2: oldest-first still fails walk-ins', () => {
  assert.equal(play(level2, design({ policy: 'fifo' })).passed, false);
});

test('3.2: a range of fair-share settings passes, and too generous a share fails', () => {
  const clear = [2, 3, 4, 5, 6].filter(n => clearPass(play(level2, design({ policy: 'weighted', mobileEvery: n })).s));
  assert.ok(clear.length >= 2, `clearly passing N: ${clear.join(', ')}`);
  assert.equal(play(level2, design({ policy: 'weighted', mobileEvery: 2 })).passed, false, 'every 2nd drink is too much for the app');
});
