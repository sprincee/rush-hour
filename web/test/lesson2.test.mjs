// Lesson 2's levels must stay winnable, and each must force the trade-off it teaches.
// If a change to the engine or shop settings breaks one of these, the level needs retuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/engine.mjs';
import { LEVELS, evaluate, designCost } from '../src/lessons/lesson2.mjs';
import { run } from './helpers.mjs';

const [level1, level2, level3] = LEVELS;
const completeRun = run;
const play = (level, design) => evaluate(level, design, summarize(run(design)));

test('every level starts in a design that fails, so there is something to learn', () => {
  for (const level of LEVELS) {
    assert.equal(play(level, level.start).passed, false, `level ${level.id}`);
  }
});

test('2.1: no number of baristas you can afford gets by without a rail', () => {
  for (let baristas = 1; baristas <= 4; baristas++) {
    const design = { baristas, rail: false, capacity: Infinity };
    assert.equal(play(level1, design).passed, false, `${baristas} baristas`);
  }
});

test('2.1: adding the rail passes', () => {
  assert.equal(play(level1, { baristas: 2, rail: true, capacity: Infinity }).passed, true);
});

test('2.2: two baristas are too slow, three pass with room to spare', () => {
  assert.equal(play(level2, { baristas: 2, rail: true, capacity: Infinity }).passed, false);
  const three = { baristas: 3, rail: true, capacity: Infinity };
  assert.equal(play(level2, three).passed, true);
  const wait = summarize(completeRun(three)).longestWaitMin;
  assert.ok(wait <= 40 - 4, `margin too thin: ${wait.toFixed(1)} min against a 40 min goal`);
});

test('2.2: four baristas are over budget', () => {
  assert.ok(designCost({ baristas: 4, rail: true }) > level2.budget);
});

test('2.3: with three baristas, a range of rail sizes passes', () => {
  const passing = [];
  for (let capacity = 5; capacity <= 50; capacity++) {
    if (play(level3, { baristas: 3, rail: true, capacity }).passed) passing.push(capacity);
  }
  assert.ok(passing.length >= 5, `only ${passing.length} rail sizes pass: ${passing.join(', ')}`);
});

test('2.3: too small turns away too many, too big makes waits too long', () => {
  const small = summarize(completeRun({ baristas: 3, rail: true, capacity: 8 }));
  const big = summarize(completeRun({ baristas: 3, rail: true, capacity: 40 }));
  assert.ok(small.rejected > 25);
  assert.ok(big.longestWaitMin > 20);
});
