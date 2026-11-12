// Lesson 1's levels must stay winnable, and each must force the trade-off it teaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/engine.mjs';
import { LEVELS, evaluate, designCost } from '../src/lessons/lesson1.mjs';
import { run } from './helpers.mjs';

const [waits, answer] = LEVELS;
const MARGIN = 1.5;
const play = (level, d) => {
  const s = summarize(run(d, { rush: level.rush }));
  return { ...evaluate(level, d, s), s };
};
const at = (level, overrides) => ({ ...level.start, ...overrides });

test('every level starts in a design that fails', () => {
  for (const level of LEVELS) assert.equal(play(level, level.start).passed, false, `level ${level.id}`);
});

test('sync: hiring more baristas never shortens the wait', () => {
  const wait = b => summarize(run({ baristas: b, rail: true, sync: true }, { rush: waits.rush })).longestWaitMin;
  for (let b = 2; b <= 4; b++) assert.equal(wait(b), wait(1), `${b} baristas`);
});

test('sync: only about one barista is ever busy', () => {
  const s = summarize(run({ baristas: 3, rail: true, sync: true }, { rush: waits.rush }));
  assert.ok(s.utilization < 0.4, `utilization ${s.utilization}`);
});

test('1.1: even the most baristas you can afford fail while the cashier waits', () => {
  assert.ok(designCost({ baristas: 4, rail: true }) <= waits.budget, 'four baristas should be affordable, so players can try');
  const r = play(waits, at(waits, { baristas: 4, sync: true }));
  assert.ok(r.s.longestWaitMin >= 15 + MARGIN, `${r.s.longestWaitMin}`);
});

test('1.1: calling names with two baristas passes clearly; one barista is not enough', () => {
  const two = play(waits, at(waits, { baristas: 2, sync: false }));
  assert.ok(two.passed && two.s.longestWaitMin <= 15 - MARGIN, `${two.s.longestWaitMin}`);
  assert.equal(play(waits, at(waits, { baristas: 1, sync: false })).passed, false);
});

test('async answers every customer within seconds', () => {
  const s = summarize(run({ baristas: 2, rail: true, sync: false }, { rush: answer.rush }));
  assert.ok(s.longestAnswerMin < 0.5, `${s.longestAnswerMin}`);
});

test('1.2: sync fails the answer goal; async with two baristas fails the drink goal; three pass', () => {
  assert.ok(play(answer, at(answer, { baristas: 3, sync: true })).s.longestAnswerMin > 2 + MARGIN);
  const two = play(answer, at(answer, { baristas: 2, sync: false }));
  assert.equal(two.passed, false);
  assert.ok(two.s.longestWaitMin >= 10 + MARGIN, `${two.s.longestWaitMin}`);
  const three = play(answer, at(answer, { baristas: 3, sync: false }));
  assert.ok(three.passed && three.s.longestWaitMin <= 10 - MARGIN, `${three.s.longestWaitMin}`);
});

test('1.2: four baristas are over budget', () => {
  assert.ok(designCost({ baristas: 4, rail: true }) > answer.budget);
});
