// Lesson 2, the order line: levels, goals, and the concept each level teaches.
// Kept as data so the game and the tests read the same definitions.

import { COST, designCost, evaluate, spendAtMost, solveIn, minutes } from './common.mjs';

export { COST, designCost, evaluate };

export const LEVELS = [
  {
    id: '2.1', name: 'Nobody walks out', budget: 40, rush: 'lesson-2',
    brief: 'Fifty commuters will walk in over the next ten minutes. Right now the cashier only takes an order if a barista can start it on the spot. Anyone else walks out. Design a shop where nobody has to leave.',
    start: { baristas: 2, rail: false, capacity: Infinity }, capacityUnlocked: false,
    goals: [{ live: { kind: 'serveAll' }, label: 'Serve all 50 customers', got: s => `${s.served} served`, ok: s => s.rejected === 0 }],
    concept: {
      term: 'Queue',
      body: 'A queue lets a system accept work now and do it later. Without one, a request that arrives while every worker is busy has to be rejected, even though the workers would be free a minute later.',
      real: 'The register is an <strong>API server</strong>. It answers <code>202 Accepted</code> and puts the order in a queue such as Redis Streams, Amazon SQS or Kafka. Workers take jobs from the queue when they are free.',
    },
  },
  {
    id: '2.2', name: 'Too long a wait', budget: 60, rush: 'lesson-2',
    brief: 'Everyone got a drink, but some people waited close to an hour. Your manager wants every drink out within 40 minutes of walking in, and gave you a bigger budget for today.',
    start: { baristas: 2, rail: true, capacity: Infinity }, capacityUnlocked: false,
    goals: [
      { live: { kind: 'serveAll' }, label: 'Serve all 50 customers', got: s => `${s.served} served`, ok: s => s.rejected === 0 },
      { live: { kind: 'wait', limit: 40 }, label: 'Nobody waits more than 40 minutes', got: s => `longest ${s.longestWaitMin.toFixed(1)} min`, ok: s => s.longestWaitMin <= 40 },
    ],
    concept: {
      term: 'Throughput',
      body: 'A queue holds work, but it does not do the work any faster. How fast the line moves depends on throughput: how many jobs your workers finish per minute. Your wait is roughly the number of jobs ahead of you divided by the throughput.',
      real: 'Two baristas making 2½-minute drinks finish about 0.8 drinks a minute. Three finish about 1.2. Adding more workers to share the load is called <strong>horizontal scaling</strong>, and it comes back in lesson 5.',
    },
  },
  {
    id: '2.3', name: 'Know when to say no', budget: 60, rush: 'lesson-2',
    brief: 'Waiting 30 minutes for a latte is worse than going somewhere else. Your manager says nobody should wait more than 20 minutes. When the rail is full, the cashier should apologize and turn people away. Decide how many tickets the rail can hold.',
    start: { baristas: 2, rail: true, capacity: 30 }, capacityUnlocked: true,
    goals: [
      { live: { kind: 'wait', limit: 20 }, label: 'Nobody waits more than 20 minutes', got: s => `longest ${s.longestWaitMin.toFixed(1)} min`, ok: s => s.longestWaitMin <= 20 },
      { live: { kind: 'atMost', of: 'rejected', limit: 25 }, label: 'Turn away 25 customers or fewer', got: s => `${s.rejected} turned away`, ok: s => s.rejected <= 25 },
    ],
    concept: {
      term: 'Bounded queue',
      body: 'Real queues have a limit. When the queue is full, the system rejects new work right away instead of making people wait forever. Picking the limit is a trade-off: too small and you turn away too many people, too big and waits get unacceptable.',
      real: 'A full queue answers <code>503 Service Unavailable</code> or <code>429 Too Many Requests</code>, so the client knows to try later. Rejecting work on purpose to protect everyone else is the start of <strong>backpressure</strong>, which is lesson 7.',
    },
  },
];

// Parts from later lessons, shown as locked cards so players see what's coming.
export const LOCKED = [
  { name: 'Mobile ordering', sys: 'Priority queue', lesson: 'Lesson 3' },
  { name: 'Batch the milk', sys: 'Batching', lesson: 'Lesson 4' },
  { name: 'Second register', sys: 'Load balancer', lesson: 'Later' },
  { name: 'Pastry case', sys: 'Cache', lesson: 'Lesson 8' },
];

// Drinks per minute: baristas divided by the average drink time (about 2.55 shop minutes).
const throughput = d => (d.baristas / 2.55).toFixed(1);
const mins = s => s.longestWaitMin.toFixed(1);

// Freeze frames: the rush pauses the first time each of these happens in a visit, with a
// card in shop words plus the software term. `on` is the trigger (see shop-game.mjs);
// `level`, `why`, and `goal` narrow it. `xray: true` flips the X-ray on for the moment.
export const MOMENTS = [
  {
    id: 'walkout', on: 'rejected', why: 'noqueue', title: 'Nowhere to wait',
    text: ({ c, d }) => `All ${d.baristas} baristas are busy, so customer ${c.id} walks out.`,
    soft: 'With no free worker and no queue, the API answers <b>503</b>. The order is lost, even though a barista frees up a minute later.',
  },
  {
    id: 'queued', on: 'queued', title: 'First ticket on the rail', xray: true,
    text: ({ ticket }) => `Every barista is busy, so customer ${ticket.id}'s order waits on the rail.`,
    soft: 'The API <b>accepted</b> the request (202) and put it in a <b>queue</b>. The blue block is the message waiting. A worker takes it as soon as one is free.',
  },
  {
    id: 'draining', on: 'goalRisk', level: '2.2', goal: 1, title: 'The line is getting long',
    text: ({ run, d }) => `${run.rail.length} tickets are waiting, and ${d.baristas} baristas finish about ${throughput(d)} drinks a minute. The last ticket has roughly ${Math.round(run.rail.length / Number(throughput(d)))} more minutes to go.`,
    soft: 'A queue holds work, but it only drains as fast as the <b>workers</b> finish it: wait ≈ tickets ahead ÷ <b>throughput</b>.',
  },
  {
    id: 'rail-full', on: 'rejected', why: 'full', title: 'The rail is full',
    text: ({ c, d }) => `The rail holds ${d.capacity} tickets, so the cashier says sorry to customer ${c.id}.`,
    soft: 'A <b>bounded queue</b> rejects new work when it is full (503), so nobody waits forever. Picking the limit is the trade-off in this level.',
  },
];

// What happened, in system design terms. s.ok is whether every goal was met.
LEVELS[0].explain = (d, s) => {
  if (!d.rail) return `Every request that arrived while all ${d.baristas} barista${d.baristas > 1 ? 's were' : ' was'} busy got a <strong>503</strong>. The workers weren't slow: they were busy ${Math.round(s.utilization * 100)}% of the time. The problem is that a request had nowhere to wait. Adding baristas costs $${COST.barista} each and only saves a few more people. What could hold an order until someone is free?`;
  return `The rail held every order until a barista was free, so nobody was turned away. Look at the longest wait though: <strong>${mins(s)} minutes</strong>. The queue saved everyone, but it didn't make anyone faster.`;
};
LEVELS[1].explain = (d, s) => {
  if (!d.rail) return `Without the rail, ${s.rejected} customers were turned away. Keep the queue, and think about what makes it drain faster.`;
  if (!s.ok) return `Everyone was served, but the longest wait was <strong>${mins(s)} minutes</strong>. ${d.baristas} baristas finish about ${throughput(d)} drinks a minute, and ${s.peakQueue} tickets piled up. The queue can only drain as fast as your workers finish jobs.`;
  return `${d.baristas} baristas finish about ${throughput(d)} drinks a minute, so the rail drained in time and the longest wait was <strong>${mins(s)} minutes</strong>. A queue holds work. Workers do it.`;
};
LEVELS[2].explain = (d, s) => {
  if (!d.rail) return `Without the rail, ${s.rejected} customers were turned away. You need a queue, just not an endless one.`;
  const long = s.longestWaitMin > 20, many = s.rejected > 25;
  if (long && many) return 'Both goals missed. Try more baristas, then tune the rail size.';
  if (long) return `Your rail let ${s.peakQueue} tickets pile up. At about ${throughput(d)} drinks a minute, the last ticket waited <strong>${mins(s)} minutes</strong>. A smaller rail turns people away sooner instead of making them wait. More baristas let you keep a bigger rail.`;
  if (many) return `The rail filled up and turned away <strong>${s.rejected}</strong> customers. A bigger rail, or more baristas to drain it faster, would keep more of them.`;
  return `A rail of ${d.capacity} with ${d.baristas} barista${d.baristas > 1 ? 's' : ''} kept every wait under 20 minutes and turned away ${s.rejected}. That's the trade-off a queue limit makes: a quick "sorry, we're full" for some people, so nobody waits forever.`;
};

// Your call: one question before each rush, and a stretch star. See starsFor in common.mjs.
LEVELS[0].predict = {
  q: () => 'How many of the 50 customers will walk out?',
  options: [
    { label: 'Nobody', test: s => s.rejected === 0 },
    { label: '1 to 20', test: s => s.rejected <= 20 },
    { label: 'More than 20', test: () => true },
  ],
  actual: s => `${s.rejected} walked out`,
};
LEVELS[0].stretch = spendAtMost(20);
LEVELS[1].predict = {
  q: () => 'How long will the longest wait be?',
  options: [
    { label: 'Under 20 minutes', test: s => s.longestWaitMin < 20 },
    { label: '20 to 40 minutes', test: s => s.longestWaitMin <= 40 },
    { label: 'Over 40 minutes', test: () => true },
  ],
  actual: s => `longest ${mins(s)} min`,
};
LEVELS[1].stretch = solveIn(3);
LEVELS[2].predict = {
  q: d => (d.rail && Number.isFinite(d.capacity)
    ? `Your rail holds ${d.capacity} tickets. How many customers will be turned away?`
    : 'How many customers will be turned away?'),
  options: [
    { label: 'Fewer than 15', test: s => s.rejected < 15 },
    { label: '15 to 25', test: s => s.rejected <= 25 },
    { label: 'More than 25', test: () => true },
  ],
  actual: s => `${s.rejected} turned away`,
};
LEVELS[2].stretch = { label: 'Turn away 20 or fewer', ok: s => s.rejected <= 20 };

// ---------- The brief: learn first ----------
// See lesson 1 for the format. Cards name the concept but never say which setting wins.
const SOFT = '<p class="brief-soft"><span class="slo">IN SOFTWARE</span>';

LEVELS[0].intro = [
  {
    stub: 'The situation', title: 'Fifty commuters',
    html: `<p>Fifty commuters will walk in over the next ten minutes, and you have two baristas.</p>
      <p>Right now there's nowhere for an order to wait. The cashier only takes an order if a barista can start it on the spot. Anyone who arrives while both baristas are busy walks back out.</p>`,
  },
  {
    stub: 'The idea', title: 'A queue',
    html: `<p>A <strong>queue</strong> lets you take work now and do it later. In the shop it's the ticket rail: the cashier prints a ticket and clips it to the rail, and baristas take tickets from the rail whenever they're free.</p>
      <p>Without one, an order that arrives while everyone is busy is simply lost, even though a barista would be free a minute later.</p>
      ${SOFT}The register is an API server. With a queue it answers <b>202 Accepted</b> and adds a message to the queue, such as Redis Streams. Without one, a request that finds every worker busy gets a <b>503</b>.</p>`,
  },
  {
    stub: 'Your job', title: 'Nobody walks out',
    html: `<p>Serve all <strong>50 customers</strong> within a <strong>$40</strong> budget. Each barista costs $18 for the rush, and the ticket rail costs $2.</p>
      <p>During the rush, watch what happens to the customers who arrive while both baristas are busy.</p>`,
  },
];

LEVELS[1].intro = [
  {
    stub: "What's new", title: 'Too long a wait',
    html: `<p>The rail saved everyone, but the last customers waited close to an hour. Today your manager wants every drink out within <strong>40 minutes</strong> of walking in, and gave you a <strong>$60</strong> budget.</p>
      <p>A queue holds work. It doesn't do it any faster. How fast the line moves is <strong>throughput</strong>: how many drinks your baristas finish per minute. Your wait is roughly the number of tickets ahead of you divided by the throughput.</p>
      ${SOFT}Adding more workers to share the load is called horizontal scaling. Lesson 5 does it automatically.</p>`,
  },
];

LEVELS[2].intro = [
  {
    stub: "What's new", title: 'Know when to say no',
    html: `<p>Waiting 30 minutes for a latte is worse than going somewhere else. Today nobody should wait more than <strong>20 minutes</strong>, and you can turn away <strong>25 customers</strong> or fewer. When the rail is full, the cashier apologizes and the customer leaves right away.</p>
      <p>A <strong>bounded queue</strong> has a limit. Too small and you turn away too many people. Too big and the last ticket waits too long. You choose how many tickets the rail holds.</p>
      ${SOFT}A full queue answers <b>503 Service Unavailable</b> or <b>429 Too Many Requests</b>, so the client knows to try later. Turning work away on purpose to protect everyone else is the start of backpressure, lesson 7.</p>`,
  },
];
