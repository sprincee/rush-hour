// Lesson 4, batching: steaming milk for two lattes at once.
// From the real shop: one latte takes 2 minutes, two batched take 2.5. Cappuccinos
// never share a pitcher, and drip needs no milk. A barista grabs a second waiting
// latte from anywhere in the queue, even past a cappuccino, and makes both.
import { COST, designCost, evaluate } from './common.mjs';

export { COST, designCost, evaluate };

const wait = s => s.longestWaitMin.toFixed(1);

export const LEVELS = [
  {
    id: '4.1', name: 'Steam for two', budget: 40, rush: 'lesson-4-1',
    brief: 'A latte-heavy morning: 28 customers in 15 minutes, and most of them want lattes. You can only afford two baristas. Nobody should wait more than 20 minutes. Steaming milk takes a big share of every latte.',
    start: { baristas: 2, rail: true, capacity: Infinity, batch: false, batchWait: 0 },
    controls: ['baristas', 'batch'],
    goals: [
      { live: { kind: 'wait', limit: 20 }, label: 'Nobody waits more than 20 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 20 },
    ],
    concept: {
      term: 'Batching',
      body: 'Doing several jobs together lets them share the setup work. One pitcher steams milk for two lattes in 1.25 times the time of one, so each latte takes 37.5% less bar time. Same baristas, more drinks per minute.',
      real: 'Databases insert rows in bulk, message queues send records in batches, and AI servers run many requests through the GPU at once. The overhead, like a network round trip or a disk write, is paid once per batch instead of once per job.',
    },
  },
  {
    id: '4.2', name: 'Should you wait for a second latte?', budget: 40, rush: 'lesson-4-2',
    brief: 'A quiet half hour: 16 customers, mostly lattes, with two baristas on. Every pitcher wastes a little milk, so your manager wants 9 pitchers or fewer. Lattes rarely arrive together now, so batching only happens if a barista holds a lone latte and waits for another. How long should they wait?',
    start: { baristas: 2, rail: true, capacity: Infinity, batch: true, batchWait: 0 },
    controls: ['batchWait'],
    goals: [
      { live: { kind: 'wait', limit: 8 }, label: 'Nobody waits more than 8 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 8 },
      { live: { kind: 'atMost', of: 'steams', limit: 9 }, label: 'Steam 9 pitchers or fewer', got: s => `${s.steams} pitchers`, ok: s => s.steams <= 9 },
    ],
    concept: {
      term: 'Batch window',
      body: 'Waiting to fill a batch saves work, but it makes the first job wait. Too short a window and you barely batch at all. Too long and everyone waits for a partner who may never come. In a busy shop, batches form on their own; in a quiet one, you have to choose the trade-off.',
      real: 'Kafka producers call this <code>linger.ms</code>: how long to wait for more messages before sending a batch. Zero sends right away; higher means fewer, bigger requests and more latency. Services that charge per request, like Amazon SQS, make waiting worth real money.',
    },
  },
  {
    id: '4.3', name: 'The app rush', budget: 60, rush: 'lesson-4-3',
    brief: 'The app is a hit: 52 customers over half an hour, a third of them ordering ahead, mostly lattes. The shop now promises that app orders are ready by the time the customer walks in, about 10 minutes. Walk-ins still wait 15 minutes or less. You know the ticket rules from lesson 3 and batching from this lesson. Which do you need?',
    start: { baristas: 3, rail: true, capacity: Infinity, policy: 'walkin', mobileEvery: 5, batch: false, batchWait: 0 },
    controls: ['baristas', 'policy', 'batch'],
    policies: ['fifo', 'walkin', 'mobile', 'weighted'],
    goals: [
      { live: { kind: 'wait', limit: 15, channel: 'walkin' }, label: 'Walk-ins wait 15 minutes or less', got: s => `longest ${s.walkin.longestWaitMin.toFixed(1)} min`, ok: s => s.walkin.longestWaitMin <= 15 },
      { live: { kind: 'wait', limit: 10, channel: 'mobile' }, label: 'App orders ready within 10 minutes', got: s => `longest ${s.mobile.longestWaitMin.toFixed(1)} min`, ok: s => s.mobile.longestWaitMin <= 10 },
    ],
    concept: {
      term: 'Do less work, and share it fairly',
      body: 'Lesson 3\'s rules decide who waits. When the bar can\'t keep up, every order of tickets leaves somebody missing their goal, so you need batching to make the bar faster. But batching alone isn\'t enough either: with strict "walk-ins first", walk-ins keep arriving and app orders still starve. You need both lessons at once.',
      real: 'When a system is overloaded, prioritizing only chooses who suffers. Real systems combine both: fair scheduling so no kind of traffic waits forever, and batching (or caching, lesson 8) to cut the work itself. Strict priority is also fragile: a fraction of a second\'s difference can decide whether a low-priority request waits 3 minutes or 20.',
    },
  },
];

export const LOCKED = [
  { name: 'More baristas on demand', sys: 'Autoscaling', lesson: 'Lesson 5' },
  { name: 'No boxes of coffee in a rush', sys: 'Rate limiting', lesson: 'Lesson 6' },
  { name: 'Second register', sys: 'Load balancer', lesson: 'Later' },
  { name: 'Pastry case', sys: 'Cache', lesson: 'Lesson 8' },
];

// What happened, in system design terms. s.ok is whether every goal was met.
LEVELS[0].explain = (d, s) => {
  if (s.ok) return `Your baristas steamed ${s.batches} pitchers for two, so ${s.batches * 2} lattes shared a pitcher. The longest wait was <strong>${wait(s)} minutes</strong>. Same two baristas, a lot more drinks per minute.`;
  if (!d.batch) return `Every latte got its own pitcher: ${s.steams} pitchers in all. Two baristas couldn't keep up, and the longest wait hit <strong>${wait(s)} minutes</strong>. A third barista is over budget. Is there a way to get more out of the two you have?`;
  return `Batching helped (${s.batches} pairs), but with ${d.baristas} barista${d.baristas > 1 ? 's' : ''} the longest wait was still <strong>${wait(s)} minutes</strong>.`;
};
LEVELS[1].explain = (d, s) => {
  const minutes = d.batchWait / 60;
  if (s.ok) return `Holding a lone latte for up to ${minutes} minute${minutes === 1 ? '' : 's'} paired up ${s.batches * 2} lattes, so you steamed only ${s.steams} pitchers, and the longest wait stayed at <strong>${wait(s)} minutes</strong>. A short window caught most partners without making anyone wait long.`;
  if (s.steams > 9) return `With ${minutes === 0 ? 'no waiting' : `only ${minutes} minute${minutes === 1 ? '' : 's'} of waiting`}, lattes rarely met a partner: <strong>${s.steams} pitchers</strong>. Drinks went out fast (longest ${wait(s)} min), but you used too much milk.`;
  return `Waiting up to ${minutes} minutes saved milk (${s.steams} pitchers), but some customers waited <strong>${wait(s)} minutes</strong> for a partner latte that took its time.`;
};
LEVELS[2].explain = (d, s) => {
  const w = s.walkin.longestWaitMin.toFixed(1), m = s.mobile.longestWaitMin.toFixed(1);
  if (s.ok) return `Batching made the bar fast enough for both promises: walk-ins waited at most <strong>${w} minutes</strong> and app orders <strong>${m} minutes</strong>. ${s.batches} pitchers were shared, many between a walk-in latte and an app latte from the other rail.`;
  if (!d.batch) return `No ticket rule can fix this one: walk-ins waited up to <strong>${w} minutes</strong> and app orders up to <strong>${m} minutes</strong>. Moving tickets around only changes who misses their goal. The bar needs to get through more drinks.`;
  if (d.policy === 'walkin') return `Batching made the bar faster, and walk-ins waited at most ${w} minutes. But walk-ins never stopped coming, so app orders only moved when the walk-in rail was empty, and some waited <strong>${m} minutes</strong>. That's lesson 3's starvation, still here. Batching needs a fair rule to go with it.`;
  return `Batching helped, but the goals were still missed: walk-ins ${w} minutes, app orders ${m} minutes.`;
};
