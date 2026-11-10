// How the shop behaves. Run with: npm test (from web/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, createRun, processEvents, sample } from '../src/engine.mjs';
import { buildSchedule } from '../src/arrivals.mjs';
import { config, run } from './helpers.mjs';

const twoWithRail = { baristas: 2, rail: true, capacity: Infinity };
const CUSTOMERS = config.rush.customers;

test('the same design always gives the same rush', () => {
  assert.deepEqual(summarize(run(twoWithRail)), summarize(run(twoWithRail)));
});

test("drawing customers' looks never changes the rush", () => {
  // Regression: looks once shared the arrivals' random numbers, so the animated
  // game got different results from these tests.
  const look = (c, rand) => { c.shirt = rand(); c.skin = rand(); c.hair = rand(); c.phase = rand(); };
  for (const design of [twoWithRail, { baristas: 3, rail: true, capacity: 20 }]) {
    assert.deepEqual(summarize(run(design, { look })), summarize(run(design)), JSON.stringify(design));
  }
});

test('customers arrive exactly as the shared schedule says', () => {
  const schedule = buildSchedule(config);
  const customers = createRun(twoWithRail, { config }).customers;
  assert.equal(customers.length, CUSTOMERS);
  customers.forEach((c, i) => {
    assert.equal(c.arriveAt, schedule[i].at);
    assert.equal(c.item, schedule[i].item);
  });
});

test('every customer is either served or turned away', () => {
  for (const design of [
    { baristas: 1, rail: false, capacity: Infinity },
    { baristas: 3, rail: true, capacity: Infinity },
    { baristas: 2, rail: true, capacity: 10 },
  ]) {
    const s = summarize(run(design));
    assert.equal(s.served + s.rejected, CUSTOMERS, JSON.stringify(design));
  }
});

test('without a rail, nothing ever waits in the queue', () => {
  const s = summarize(run({ baristas: 2, rail: false, capacity: Infinity }));
  assert.equal(s.peakQueue, 0);
  assert.ok(s.rejected > 0);
});

test('an unlimited rail turns nobody away', () => {
  assert.equal(summarize(run(twoWithRail)).rejected, 0);
});

test('the rail never holds more than its limit', () => {
  for (const capacity of [5, 12, 20]) {
    const r = createRun({ baristas: 2, rail: true, capacity }, { config });
    let most = 0;
    while (r.events.length) {
      r.t = r.events[0].t;
      processEvents(r);
      most = Math.max(most, r.rail.length);
    }
    assert.ok(most <= capacity, `capacity ${capacity} held ${most}`);
  }
});

test('baristas take the oldest ticket first', () => {
  const r = createRun(twoWithRail, { config });
  const started = [];
  while (r.events.length) {
    r.t = r.events[0].t;
    processEvents(r);
    for (const b of r.baristas) {
      if (b.ticket && !started.includes(b.ticket.id)) started.push(b.ticket.id);
    }
  }
  assert.equal(started.length, CUSTOMERS);
  assert.deepEqual(started, [...started].sort((x, y) => x - y));
});

test('more baristas never make the longest wait worse', () => {
  let previous = Infinity;
  for (let baristas = 1; baristas <= 4; baristas++) {
    const wait = summarize(run({ baristas, rail: true, capacity: Infinity })).longestWaitMin;
    assert.ok(wait <= previous, `${baristas} baristas waited ${wait}, more than ${previous}`);
    previous = wait;
  }
});

test('stepping time like the animation gives the same result as running instantly', () => {
  const design = { baristas: 3, rail: true, capacity: Infinity };
  const instant = summarize(run(design));
  for (const step of [0.5, 6, 12]) {
    const r = createRun(design, { config });
    while (r.events.length) { r.t += step; sample(r); processEvents(r); }
    assert.equal(summarize(r).longestWaitMin, instant.longestWaitMin, `step ${step}s`);
  }
});

test('workers are never busy more than all of the time', () => {
  const s = summarize(run({ baristas: 1, rail: true, capacity: Infinity }));
  assert.ok(s.utilization > 0 && s.utilization <= 1);
});
