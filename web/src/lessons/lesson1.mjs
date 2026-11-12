// Lesson 1, async vs sync: order at the register, then your name gets called.
// Sync: the cashier takes your order, then waits at the bar until your drink is
// made before taking the next customer. Async: the cashier prints a ticket, says
// "we'll call your name", and takes the next order right away.
import { COST, designCost, evaluate } from './common.mjs';

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
      { label: 'Nobody waits more than 15 minutes for their drink', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 15 },
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
      { label: 'Every customer gets an answer within 2 minutes', got: s => `longest ${answer(s)} min`, ok: s => s.longestAnswerMin <= 2 },
      { label: 'Every drink is ready within 10 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 10 },
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
