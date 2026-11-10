// Does the game behave like the real system? Compares the simulation with a real
// rush recorded on the cluster by: .\scripts\rush.ps1 -Record
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRun, processEvents } from '../src/engine.mjs';
import { config, configHash } from './helpers.mjs';

const FIXTURE = new URL('./fixtures/real-rush.json', import.meta.url);

// How close counts as "the same". See the calibration section of docs/design.md.
const TOLERANCE = {
  longestWaitRatio: 0.10, // Longest wait within 10%.
  finishRatio: 0.10, // Last drink out within 10% of the same time.
  meanWaitDiffMin: 2, // Average per-order difference under 2 shop minutes.
  peakQueueDiff: 3, // Peak queue within 3 tickets.
};

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function simulate(design) {
  const run = createRun(design, { config });
  const started = new Map();
  while (run.events.length) {
    run.t = run.events[0].t;
    processEvents(run);
    for (const b of run.baristas) if (b.ticket && !started.has(b.ticket.id)) started.set(b.ticket.id, b.startAt);
  }
  return run.customers.map(c => ({ id: c.id, item: c.item, orderedAt: c.orderedAt, startedAt: started.get(c.id), readyAt: c.readyAt }));
}

// Queue depth at time t: accepted, but no barista has started it yet.
const depthAt = (orders, t) => orders.filter(o => o.orderedAt <= t && o.startedAt > t).length;

test('the game matches a real rush on the cluster', t => {
  if (!existsSync(FIXTURE)) { t.skip('no recording yet: run .\\scripts\\rush.ps1 -Record'); return; }
  const real = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  if (real.configHash !== configHash) { t.skip('recorded with different shop settings: re-record with .\\scripts\\rush.ps1 -Record'); return; }

  const scale = config.timeScale;
  const design = { ...real.design, capacity: real.design.capacity ?? Infinity };
  const sim = simulate(design);
  const byId = new Map(sim.map(o => [o.id, o]));

  assert.equal(real.orders.length, sim.length, 'every customer in the schedule was recorded');
  for (const o of real.orders) {
    assert.equal(o.status, 'ready', `order ${o.id} was made`);
    assert.equal(o.item, byId.get(o.id).item, `order ${o.id} is the drink the schedule says`);
  }

  // Line real clock times up with shop time, using the moment each order was accepted.
  const start = median(real.orders.map(o => o.createdAt - byId.get(o.id).orderedAt / scale));
  const toShop = ts => (ts - start) * scale;
  const realShop = real.orders.map(o => ({ id: o.id, orderedAt: toShop(o.createdAt), startedAt: toShop(o.startedAt), readyAt: toShop(o.readyAt) }));

  const waitMin = o => (o.readyAt - o.orderedAt) / 60;
  const realWaits = realShop.map(waitMin), simWaits = sim.map(waitMin);
  const realLongest = Math.max(...realWaits), simLongest = Math.max(...simWaits);
  const realFinish = Math.max(...realShop.map(o => o.readyAt)) / 60, simFinish = Math.max(...sim.map(o => o.readyAt)) / 60;
  const meanDiff = realShop.reduce((s, o) => s + Math.abs(waitMin(o) - waitMin(byId.get(o.id))), 0) / realShop.length;
  const times = Array.from({ length: Math.ceil(simFinish * 4) }, (_, i) => i * 15);
  const realPeak = Math.max(...times.map(x => depthAt(realShop, x)));
  const simPeak = Math.max(...times.map(x => depthAt(sim, x)));

  t.diagnostic(`longest wait: real ${realLongest.toFixed(1)} min, game ${simLongest.toFixed(1)} min`);
  t.diagnostic(`last drink out: real ${realFinish.toFixed(1)} min, game ${simFinish.toFixed(1)} min`);
  t.diagnostic(`average per-order wait difference: ${meanDiff.toFixed(2)} min`);
  t.diagnostic(`peak queue: real ${realPeak}, game ${simPeak}`);

  assert.ok(Math.abs(realLongest - simLongest) / simLongest <= TOLERANCE.longestWaitRatio, 'longest wait');
  assert.ok(Math.abs(realFinish - simFinish) / simFinish <= TOLERANCE.finishRatio, 'finish time');
  assert.ok(meanDiff <= TOLERANCE.meanWaitDiffMin, 'per-order waits');
  assert.ok(Math.abs(realPeak - simPeak) <= TOLERANCE.peakQueueDiff, 'peak queue');
});
