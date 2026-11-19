// A level's verdicts must not hinge on split-second timing. The real cluster runs a
// little behind the game (network and polling delays of a few milliseconds), and
// once that flipped a 4.3 verdict (see docs/design.md). So every design a level
// treats as a clear pass or fail must keep its verdict when every arrival is
// nudged by a few shop seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completeRun, summarize } from '../src/engine.mjs';
import * as lesson1 from '../src/lessons/lesson1.mjs';
import * as lesson2 from '../src/lessons/lesson2.mjs';
import * as lesson3 from '../src/lessons/lesson3.mjs';
import * as lesson4 from '../src/lessons/lesson4.mjs';
import * as lesson5 from '../src/lessons/lesson5.mjs';
import * as lesson6 from '../src/lessons/lesson6.mjs';
import * as lesson7 from '../src/lessons/lesson7.mjs';
import * as lesson8 from '../src/lessons/lesson8.mjs';

const config = JSON.parse(readFileSync(new URL('../../shop/config.json', import.meta.url), 'utf8'));
const NOISE_SECONDS = 12;
const RUNS = 16;
const REQUIRED = 0.95; // Of the noisy runs, at least this share must agree with the verdict.

// [lesson, level id, description, design changes, should it pass?]
const CASES = [
  [lesson1, '1.1', 'call names, 2 baristas', { sync: false, baristas: 2 }, true],
  [lesson1, '1.1', 'cashier waits, 4 baristas', { baristas: 4 }, false],
  [lesson1, '1.2', 'call names, 3 baristas', { sync: false, baristas: 3 }, true],
  [lesson1, '1.2', 'call names, 2 baristas', { sync: false }, false],
  [lesson2, '2.1', 'ticket rail', { rail: true }, true],
  [lesson2, '2.2', '3 baristas', { baristas: 3 }, true],
  [lesson2, '2.2', '2 baristas', {}, false],
  [lesson2, '2.3', '3 baristas, rail of 13', { baristas: 3, capacity: 13 }, true],
  [lesson2, '2.3', '3 baristas, rail of 16', { baristas: 3, capacity: 16 }, true],
  [lesson3, '3.1', 'walk-ins first', { policy: 'walkin' }, true],
  [lesson3, '3.1', 'oldest first', { policy: 'fifo' }, false],
  [lesson3, '3.2', 'every 5th from the app', { policy: 'weighted', mobileEvery: 5 }, true],
  [lesson3, '3.2', 'walk-ins first', { policy: 'walkin' }, false],
  [lesson4, '4.1', 'batching', { batch: true }, true],
  [lesson4, '4.1', 'no batching', {}, false],
  [lesson4, '4.2', '3-minute batch window', { batchWait: 180 }, true],
  [lesson4, '4.2', 'no batch window', { batchWait: 0 }, false],
  [lesson4, '4.2', '6-minute batch window', { batchWait: 360 }, false],
  [lesson4, '4.3', 'oldest first + batching', { policy: 'fifo', batch: true }, true],
  [lesson4, '4.3', 'every 3rd + batching', { policy: 'weighted', mobileEvery: 3, batch: true }, true],
  [lesson4, '4.3', 'walk-ins first + batching', { policy: 'walkin', batch: true }, false],
  [lesson4, '4.3', 'every 3rd, no batching', { policy: 'weighted', mobileEvery: 3 }, false],
  [lesson5, '5.1', 'call in baristas, starting with 1', { autoscale: true, baristas: 1 }, true],
  [lesson5, '5.1', '3 baristas all morning', { baristas: 3 }, false],
  [lesson5, '5.1', '4 baristas all morning', { baristas: 4 }, false],
  [lesson5, '5.2', 'start with 2, call in at 1 per barista', { baristas: 2, scaleAt: 1 }, true],
  [lesson5, '5.2', 'start with 1, call in at 3 per barista', {}, false],
  [lesson5, '5.3', '3-minute cooldown', { cooldown: 180 }, true],
  [lesson5, '5.3', 'sent home right away', { cooldown: 0 }, false],
  [lesson5, '5.3', '10-minute cooldown', { cooldown: 600 }, false],
  [lesson6, '6.1', 'no boxes in the rush', { boxRule: 'none' }, true],
  [lesson6, '6.1', 'every box', { boxRule: 'all' }, false],
  [lesson6, '6.2', 'one box every 7 minutes', { boxRule: 'bucket', boxEvery: 420 }, true],
  [lesson6, '6.2', 'no boxes in the rush', { boxRule: 'none' }, false],
  [lesson6, '6.2', 'every box', { boxRule: 'all' }, false],
  [lesson7, '7.1', 'pause at 6 tickets', { pause: true, pauseAt: 6 }, true],
  [lesson7, '7.1', 'never pause', { pause: false }, false],
  [lesson7, '7.2', 'pause at 10 tickets', { pause: true, pauseAt: 10 }, true],
  [lesson7, '7.2', 'pause at 4 tickets', { pause: true, pauseAt: 4 }, false],
  [lesson8, '8.1', 'a case of 12', { caseSize: 12 }, true],
  [lesson8, '8.1', 'no case', { caseSize: 0 }, false],
  [lesson8, '8.2', 'a case of 16', { caseSize: 16 }, true],
  [lesson8, '8.2', 'a case of 8', { caseSize: 8 }, false],
];

for (const [lesson, id, name, changes, shouldPass] of CASES) {
  test(`${id}: "${name}" ${shouldPass ? 'passes' : 'fails'} even with small timing noise`, () => {
    const level = lesson.LEVELS.find(l => l.id === id);
    const design = { ...level.start, ...changes };
    let agree = 0;
    for (let k = 0; k < RUNS; k++) {
      const s = summarize(completeRun(design, { config, rush: level.rush, jitter: { seconds: NOISE_SECONDS, seed: 7000 + k } }));
      if (lesson.evaluate(level, design, s).passed === shouldPass) agree++;
    }
    assert.ok(agree / RUNS >= REQUIRED, `agreed in only ${agree} of ${RUNS} noisy runs`);
  });
}
