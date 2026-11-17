// Lesson 1, async vs sync: order at the register, then your name gets called.
// Sync: the cashier takes your order, then waits at the bar until your drink is
// made before taking the next customer. Async: the cashier prints a ticket, says
// "we'll call your name", and takes the next order right away.
import { COST, designCost, evaluate, spendAtMost, solveIn, minutes } from './common.mjs';

export { COST, designCost, evaluate };

const wait = s => s.longestWaitMin.toFixed(1);
const answer = s => s.longestAnswerMin.toFixed(1);

export const LEVELS = [
  {
    id: '1.1', name: 'The cashier waits', budget: 80, rush: 'lesson-1-1',
    brief: 'Twenty customers over twenty minutes. Right now your cashier takes an order, walks it to the bar, and waits until the drink is made before taking the next one. You have three baristas on the clock. Nobody should wait more than 15 minutes for their drink.',
    start: { baristas: 3, rail: true, capacity: Infinity, sync: true },
    controls: ['baristas', 'async'],
    goals: [
      { live: { kind: 'wait', limit: 15 }, label: 'Nobody waits more than 15 minutes for their drink', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 15 },
    ],
    concept: {
      term: 'Synchronous vs asynchronous',
      body: 'Synchronous means the caller waits for the work to finish before doing anything else. Your cashier waited at the bar, so only one drink was ever being made, however many baristas you hired. Asynchronous means the caller hands the work off and moves on, with a ticket standing in for the finished drink.',
      real: 'A synchronous API holds each connection open until the job is done, so a slow job blocks everyone behind it. An asynchronous API answers <code>202 Accepted</code> with an order ID straight away and puts the job in a queue for workers. Rush Hour\'s register works that way, and lesson 2 is about the queue.',
    },
  },
  {
    id: '1.2', name: 'A fast answer', budget: 60, rush: 'lesson-1-2',
    brief: 'A busier morning: 24 customers in 20 minutes. Two promises now. Every customer gets an answer at the register within 2 minutes, a ticket or their drink. And every drink is ready within 10 minutes.',
    start: { baristas: 2, rail: true, capacity: Infinity, sync: true },
    controls: ['baristas', 'async'],
    goals: [
      { live: { kind: 'answer', limit: 2 }, label: 'Every customer gets an answer within 2 minutes', got: s => `longest ${answer(s)} min`, ok: s => s.longestAnswerMin <= 2 },
      { live: { kind: 'wait', limit: 10 }, label: 'Every drink is ready within 10 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 10 },
    ],
    concept: {
      term: 'Response time vs processing time',
      body: 'Going async made the answer almost instant, but the drink still takes as long as your baristas need. Those are two different numbers. Response time is how fast the system answers a request. Processing time is how long the actual work takes. Users feel both, so you design for both.',
      real: 'Teams track an API\'s response time (often its 95th percentile) separately from how long jobs take to finish: time waiting in the queue plus time being worked on. A status endpoint, like Rush Hour\'s <code>GET /orders/{id}</code>, lets the client check on the job. That\'s the "is my drink ready?" of lesson 10.',
    },
  },
];

export const LOCKED = [
  { name: 'Second register', sys: 'Load balancer', lesson: 'Later' },
  { name: 'Mobile ordering', sys: 'Priority queue', lesson: 'Lesson 3' },
  { name: 'Batch the milk', sys: 'Batching', lesson: 'Lesson 4' },
  { name: 'More baristas on demand', sys: 'Autoscaling', lesson: 'Lesson 5' },
];

const busy = s => Math.round(s.utilization * 100);

// What happened, in system design terms. s.ok is whether every goal was met.
LEVELS[0].explain = (d, s) => {
  if (d.sync) return `The cashier waited at the bar for every drink, so only one drink was ever being made. Your ${d.baristas} barista${d.baristas > 1 ? 's were' : ' was'} busy just ${busy(s)}% of the time, and the longest wait was <strong>${wait(s)} minutes</strong>. Hiring more baristas wouldn't change that. The register is the bottleneck because it waits.`;
  if (s.ok) return `The cashier printed a ticket and moved on, so the baristas could work in parallel. The longest wait dropped to <strong>${wait(s)} minutes</strong>, and the baristas were busy ${busy(s)}% of the time. Same people, no waiting at the register.`;
  return `Calling names freed the register, but with ${d.baristas} barista${d.baristas > 1 ? 's' : ''} the longest wait was still <strong>${wait(s)} minutes</strong>. Now more baristas would actually help.`;
};
LEVELS[1].explain = (d, s) => {
  if (d.sync) return `Customers waited up to <strong>${answer(s)} minutes</strong> just to get an answer at the register, because each answer was the finished drink. A synchronous answer can only be as fast as the work behind it.`;
  if (s.ok) return `Everyone got a ticket within <strong>${answer(s)} minutes</strong> and a drink within <strong>${wait(s)} minutes</strong>. Async fixed the response time; enough baristas fixed the processing time.`;
  return `Every customer got a ticket within ${answer(s)} minutes, so the response time is solved. But the longest wait for a drink was <strong>${wait(s)} minutes</strong>: async doesn't make the work itself faster. That takes more workers.`;
};

// Your call: one question before each rush, and a stretch star. See starsFor in common.mjs.
LEVELS[0].predict = {
  q: d => `How many of your ${d.baristas} barista${d.baristas > 1 ? 's' : ''} will be making drinks at the same time?`,
  options: [
    { label: 'Just one', test: s => s.maxBusy <= 1 },
    { label: 'Some of them', test: (s, d) => s.maxBusy < d.baristas },
    { label: 'All of them', test: () => true },
  ],
  actual: s => `at most ${s.maxBusy} at once`,
};
LEVELS[0].stretch = spendAtMost(40);
LEVELS[1].predict = {
  q: () => 'How long will the slowest customer wait at the register for an answer?',
  options: [
    { label: 'Seconds', test: s => s.longestAnswerMin < 1 },
    { label: 'A few minutes', test: s => s.longestAnswerMin <= 10 },
    { label: 'More than 10 minutes', test: () => true },
  ],
  actual: s => `${minutes(s.longestAnswerMin)} for an answer`,
};
LEVELS[1].stretch = solveIn(3);

// ---------- The brief: learn first ----------
// A dialog opens the first time each level does (see web/src/game/briefing.mjs). The first
// level of a lesson teaches the idea in three cards; later levels get one card that builds
// on the last. Cards name the concept but never say which setting wins.
const SOFT = '<p class="brief-soft"><span class="slo">IN SOFTWARE</span>';

LEVELS[0].intro = [
  {
    stub: 'The situation', title: '8:05 am',
    html: `<p>Twenty customers will walk in over the next twenty minutes, and you have three baristas on the clock.</p>
      <p>But your cashier has a habit: they take an order, walk it over to the bar, and stand there until the drink is made. Only then do they take the next order.</p>`,
  },
  {
    stub: 'The idea', title: 'Sync vs async',
    html: `<p>When the cashier waits at the bar, that's <strong>synchronous</strong>: the caller waits for the work to finish before doing anything else.</p>
      <p>The other way is <strong>asynchronous</strong>: print a ticket, say "we'll call your name," and take the next order right away. The ticket stands in for the drink until it's ready.</p>
      ${SOFT}A synchronous API holds each request open until the job is done, so one slow job blocks everyone behind it. An asynchronous API answers <b>202 Accepted</b> straight away and hands the job to workers.</p>`,
  },
  {
    stub: 'Your job', title: 'Nobody waits more than 15 minutes',
    html: `<p>Nobody should wait more than <strong>15 minutes</strong> for their drink. You can switch <em>Call names</em> on or off, and change how many baristas you hire.</p>
      <p>During the rush, watch how many of your baristas are actually making drinks.</p>`,
  },
];

LEVELS[1].intro = [
  {
    stub: "What's new", title: 'Two clocks',
    html: `<p>Calling names fixed the line: nobody stood at the register waiting. Today is busier, with 24 customers in 20 minutes and two baristas, and the shop makes two promises:</p>
      <ul><li>every customer gets an answer at the register within <strong>2 minutes</strong>: a ticket or their drink</li>
      <li>every drink is ready within <strong>10 minutes</strong></li></ul>
      <p><strong>Response time vs processing time.</strong> These are two different clocks. Response time is how fast the register answers. Processing time is how long the drink takes. Calling names makes the first one tiny, but the second still depends on your baristas.</p>
      ${SOFT}Teams track an API's response time separately from how long its jobs take: time waiting in the queue plus time being worked on.</p>`,
  },
];

// ---------- Aha moments ----------
// Freeze frames (see lesson 2 for the format). `mode` narrows a moment to sync or async
// designs, and `spot` names where the spotlight goes.
const WORDS = ['No', 'One', 'Two', 'Three'];
const waited = (run, c) => ((run.t - c.arriveAt) / 60).toFixed(1);

export const MOMENTS = [
  {
    id: 'sync-wait', on: 'accepted', mode: 'sync', level: '1.1', spot: 'cashier',
    title: ({ d }) => (d.baristas > 1 ? `${WORDS[d.baristas - 1]} barista${d.baristas > 2 ? 's' : ''}, nothing to do` : 'The cashier waits'),
    text: ({ c, d, item }) => `The cashier is standing at the bar waiting for customer ${c.id}'s ${item}, so nobody else can order.` +
      (d.baristas > 1 ? ` ${d.baristas - 1} of your ${d.baristas} baristas ${d.baristas > 2 ? 'are' : 'is'} idle.` : ''),
    soft: 'That\'s <b>synchronous</b>: the register holds the request open until the job is done. One request at a time, however many workers you have.',
  },
  {
    id: 'async-ticket', on: 'accepted', mode: 'async', level: '1.1', spot: 'cashier', title: "We'll call your name",
    text: ({ c }) => `The cashier printed a ticket for customer ${c.id} and is already free for the next customer.`,
    soft: 'That\'s <b>asynchronous</b>: the API answered <b>202 Accepted</b> and handed the job off, so the register is free again in seconds.',
  },
  {
    id: 'no-answer', on: 'goalRisk', level: '1.2', goal: 0, mode: 'sync', spot: 'register', title: 'Still waiting for an answer',
    text: ({ run }) => {
      const c = run.regQueue[0];
      return c ? `Customer ${c.id} has been in line for ${waited(run, c)} minutes and hasn't even got a ticket.` : 'The line at the register has waited minutes just to order.';
    },
    soft: '<b>Response time</b> is how long until the system answers at all. A synchronous API makes everyone wait for the slowest job.',
  },
  {
    id: 'slow-drink', on: 'goalRisk', level: '1.2', goal: 1, mode: 'async', title: 'Fast answer, slow drink',
    text: ({ run, d }) => `Everyone got a ticket in seconds, but ${run.rail.length} ticket${run.rail.length === 1 ? ' is' : 's are'} waiting and ${d.baristas} barista${d.baristas > 1 ? 's' : ''} can't keep up.`,
    soft: 'Response time is fine, but <b>processing time</b> isn\'t. Async answers fast; the work still needs enough workers.',
  },
];
