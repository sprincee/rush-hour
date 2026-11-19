// The live goal meters must never contradict the debrief. A goal shown as MISSED during
// the rush has to be missed at the end, and the meters' final state has to match the
// verdict exactly. Checked across every level and many designs, stepping through each rush.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, processEvents, sample, summarize } from '../src/engine.mjs';
import { liveGoal, shortLabel } from '../src/game/live-goals.mjs';
import * as lesson1 from '../src/lessons/lesson1.mjs';
import * as lesson2 from '../src/lessons/lesson2.mjs';
import * as lesson3 from '../src/lessons/lesson3.mjs';
import * as lesson4 from '../src/lessons/lesson4.mjs';
import * as lesson5 from '../src/lessons/lesson5.mjs';
import * as lesson6 from '../src/lessons/lesson6.mjs';
import * as lesson7 from '../src/lessons/lesson7.mjs';
import * as lesson8 from '../src/lessons/lesson8.mjs';
import { config } from './helpers.mjs';

const LESSONS = [lesson1, lesson2, lesson3, lesson4, lesson5, lesson6, lesson7, lesson8];

// The level's starting design, plus a spread of designs a player might try.
function designsFor(level) {
  const base = level.start;
  const out = [];
  for (const baristas of [1, 2, 3, 4]) {
    out.push({ ...base, baristas });
    out.push({ ...base, baristas, rail: !base.rail });
    if ('sync' in base) out.push({ ...base, baristas, sync: !base.sync });
    if ('batch' in base) out.push({ ...base, baristas, batch: !base.batch });
    if (base.policy) for (const policy of ['fifo', 'walkin', 'mobile', 'weighted']) out.push({ ...base, baristas, policy, batch: true });
    if (level.capacityUnlocked) for (const capacity of [5, 15, 30, 50]) out.push({ ...base, baristas, rail: true, capacity });
    if ('batchWait' in base) for (const batchWait of [0, 120, 240, 360]) out.push({ ...base, baristas, batchWait });
    if ('autoscale' in base) for (const scaleAt of [1, 3]) for (const cooldown of [0, 180, 600]) out.push({ ...base, baristas, autoscale: true, scaleAt, cooldown });
    if ('boxRule' in base) for (const boxRule of ['all', 'none', 'bucket']) out.push({ ...base, baristas, boxRule });
    if ('pause' in base) for (const pauseAt of [3, 10, 20]) out.push({ ...base, baristas, pause: true, pauseAt });
    if ('caseSize' in base) for (const caseSize of [0, 6, 16]) out.push({ ...base, baristas, caseSize });
  }
  return out;
}

for (const lesson of LESSONS) {
  for (const level of lesson.LEVELS) {
    test(`${level.id}: live goals agree with the debrief`, () => {
      for (const goal of level.goals) assert.ok(goal.live, `${level.id} "${goal.label}" has no live description`);
      for (const design of designsFor(level)) {
        const run = createRun(design, { config, rush: level.rush });
        const missedAt = level.goals.map(() => null);
        while (run.events.length) {
          run.t = Math.min(run.t + 15, run.events[run.events.length - 1].t); // Step 15 shop seconds, like animation frames.
          sample(run);
          processEvents(run);
          level.goals.forEach((g, i) => {
            const live = liveGoal(g.live, run);
            if (live.status === 'missed') missedAt[i] ??= run.t;
            else assert.equal(missedAt[i], null, `${level.id} "${g.label}" came back from MISSED`);
          });
        }
        run.finished = true;
        const s = summarize(run);
        const what = `${level.id} "${JSON.stringify(design)}"`;
        level.goals.forEach((g, i) => {
          const final = liveGoal(g.live, run, true);
          assert.equal(final.status, g.ok(s) ? 'met' : 'missed', `${what} "${g.label}": final meter disagrees with the verdict`);
          if (missedAt[i] !== null) assert.equal(g.ok(s), false, `${what} "${g.label}": shown MISSED mid-rush but met at the end`);
        });
      }
    });
  }
}

test('short labels for the strip under the shop', () => {
  assert.equal(shortLabel({ kind: 'wait', limit: 40 }), 'Wait ≤ 40 min');
  assert.equal(shortLabel({ kind: 'wait', limit: 15, channel: 'walkin' }), 'Walk-in wait ≤ 15 min');
  assert.equal(shortLabel({ kind: 'atMost', of: 'steams', limit: 9 }), 'Pitchers ≤ 9');
  assert.equal(shortLabel({ kind: 'serveAll' }), 'Serve everyone');
});
