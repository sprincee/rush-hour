// Lesson 8, the pastry case: caching.
// Grab-and-go croissants are served at the register while the case is stocked (a cache
// hit). An empty case means a barista fetches and warms one from the back (a miss).
// Idle baristas restock the case. Each slot is a pastry bought for the morning, $1.
import { COST, designCost, evaluate, solveIn } from './common.mjs';

export { COST, designCost, evaluate };

const wait = s => s.longestWaitMin.toFixed(1);
const BASE = { baristas: 2, rail: true, capacity: Infinity };

export const LEVELS = [
  {
    id: '8.1', name: 'Fill the case', budget: 52, rush: 'lesson-8',
    brief: 'Half today\'s customers just want a croissant, and every one goes on the rail.',
    start: { ...BASE, caseSize: 0 },
    controls: ['baristas', 'case'], caseDefault: 12,
    goals: [
      { live: { kind: 'wait', limit: 15 }, label: 'Nobody waits more than 15 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 15 },
    ],
    concept: { term: 'Caching', body: '', real: '' },
  },
  {
    id: '8.2', name: 'How big a case?', budget: 55, rush: 'lesson-8',
    brief: 'A bigger case serves more customers, but every slot is a pastry you might throw away.',
    start: { ...BASE, caseSize: 8 },
    controls: ['caseSize'],
    goals: [
      { live: { kind: 'wait', limit: 12 }, label: 'Nobody waits more than 12 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 12 },
    ],
    concept: { term: 'Cache size', body: '', real: '' },
  },
];

export const LOCKED = [];

LEVELS[0].explain = (d, s) => {
  if (!d.caseSize) return `Every croissant went on the rail like a drink, and a barista had to fetch and warm it. The bar was busy with orders that need no barista at all: longest wait <strong>${wait(s)} minutes</strong>.`;
  return `${s.caseHits} croissants came straight from the case, without a ticket or a barista, so the bar only made drinks: longest wait <strong>${wait(s)} minutes</strong>. That's a cache: keep popular answers ready, and skip the slow path.`;
};
LEVELS[1].explain = (d, s) => {
  if (s.ok) return `A case of ${d.caseSize} covered the rush: ${s.caseHits} hits and only ${s.caseMisses} misses, for $${d.caseSize} of pastries. Big enough for the busy stretch, and no bigger.`;
  return `A case of ${d.caseSize} ran out mid-rush. After that, ${s.caseMisses} croissants were misses: back to the rail, back to a barista. The bar only restocks when it's quiet, which is never during a rush. Longest wait <strong>${wait(s)} minutes</strong>.`;
};

LEVELS[0].predict = {
  q: () => 'How many croissants will come straight from the case?',
  options: [
    { label: 'None', test: s => s.caseHits === 0 },
    { label: 'Up to 10', test: s => s.caseHits <= 10 },
    { label: 'More than 10', test: () => true },
  ],
  actual: s => `${s.caseHits} from the case`,
};
LEVELS[0].stretch = solveIn(3);
LEVELS[1].predict = {
  q: d => `With a case of ${d.caseSize}, how many croissants will miss the case?`,
  options: [
    { label: 'None', test: s => s.caseMisses === 0 },
    { label: '1 to 5', test: s => s.caseMisses <= 5 },
    { label: 'More than 5', test: () => true },
  ],
  actual: s => `${s.caseMisses} missed the case`,
};
LEVELS[1].stretch = solveIn(3);

// ---------- The brief ----------
const SOFT = '<p class="brief-soft"><span class="slo">IN SOFTWARE</span>';

LEVELS[0].intro = [
  {
    stub: 'The situation', title: 'Just a croissant',
    html: `<p>36 customers in 15 minutes, and half of them only want a croissant. Two baristas.</p>
      <p>Right now every croissant goes on the rail like a drink. A barista leaves the bar, fetches one from the back and warms it: a minute and a half each.</p>`,
  },
  {
    stub: 'The idea', title: 'The pastry case',
    html: `<p>A <strong>pastry case</strong> by the register holds croissants ready to go. The cashier hands one over, and the bar never hears about it. If the case is empty, it's back to the rail.</p>
      <p>That's a <strong>cache</strong>: keep popular answers ready close to the customer. A croissant from the case is a <strong>hit</strong>; one from the back is a <strong>miss</strong>.</p>
      ${SOFT}Apps keep popular data in a fast cache like Redis instead of asking the database every time. This website is cached too: CloudFront keeps copies of its pages near you.</p>`,
  },
  {
    stub: 'Your job', title: 'Under 15 minutes',
    html: `<p>Nobody waits more than <strong>15 minutes</strong>, within a <strong>$52</strong> budget. A case holds 12 croissants, at $1 each.</p>
      <p>During the rush, watch who never needs a ticket.</p>`,
  },
];
LEVELS[1].intro = [{
  stub: "What's new", title: 'How big a case?',
  html: `<p>You choose the size now. Every slot is a croissant bought for the morning, and one you might throw away at closing. Goal: nobody over <strong>12 minutes</strong>, within <strong>$55</strong>.</p>
    <p>The bar only restocks the case when it's quiet, so during the rush the case only has what it started with. Too small and it runs out halfway; too big and you pay for pastries nobody buys.</p>
    ${SOFT}Caches have a size limit too. Too small and the <b>hit rate</b> drops; too big costs memory and money. Teams size a cache from how much is asked for during the busiest stretch.</p>`,
}];

// ---------- Aha moments ----------
export const MOMENTS = [
  {
    id: 'case-hit', on: 'caseHit', level: '8.1', spot: 'register', title: 'Straight from the case',
    text: ({ c }) => `Customer ${c.id} gets a croissant from the case and heads out. No ticket, no barista.`,
    soft: 'A <b>cache hit</b>: the answer was ready, so the slow path, the bar, is skipped.',
  },
  {
    id: 'case-empty', on: 'caseEmpty', level: '8.2', spot: 'register', title: 'The case is empty',
    text: ({ run }) => `The last croissant is gone, and ${run.rail.length} tickets are waiting. Until the bar is quiet enough to restock, every croissant goes on the rail.`,
    soft: 'Every <b>cache miss</b> takes the slow path. A bigger cache covers more of the rush, but costs more to keep full.',
  },
];
