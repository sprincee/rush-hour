// Lesson 3, mobile orders vs walk-ins: levels, goals, and the concept each level teaches.
// App orders print on their own printer (a second queue). Walk-ins are standing in
// the shop, so they get the tighter goal. The goals stay the same across the lesson;
// the traffic changes.
import { COST, designCost, evaluate, spendAtMost, solveIn, minutes } from './common.mjs';

export { COST, designCost, evaluate };

const WALKIN_GOAL = 15;
const APP_GOAL = 30;

const goals = [
  {
    live: { kind: 'wait', limit: WALKIN_GOAL, channel: 'walkin' },
    label: `Walk-ins wait ${WALKIN_GOAL} minutes or less`,
    got: s => `longest ${s.walkin.longestWaitMin.toFixed(1)} min`,
    ok: s => s.walkin.longestWaitMin <= WALKIN_GOAL,
  },
  {
    live: { kind: 'wait', limit: APP_GOAL, channel: 'mobile' },
    label: `App orders ready within ${APP_GOAL} minutes`,
    got: s => `longest ${s.mobile.longestWaitMin.toFixed(1)} min`,
    ok: s => s.mobile.longestWaitMin <= APP_GOAL,
  },
];

export const LEVELS = [
  {
    id: '3.1', name: 'Two printers', budget: 60, rush: 'lesson-3-1',
    brief: `The app just launched. App orders print on their own printer, so you now have two ticket rails. Customers who walk in are standing at the counter, so they should wait ${WALKIN_GOAL} minutes or less. App customers ordered ahead and can wait up to ${APP_GOAL}. Decide how baristas choose the next ticket.`,
    start: { baristas: 3, rail: true, capacity: Infinity, policy: 'fifo', mobileEvery: 3 },
    policies: ['fifo', 'walkin', 'mobile'],
    goals,
    concept: {
      term: 'Priority queue',
      body: 'Not all work is equally urgent. A priority queue lets workers take the most important waiting job first, instead of simply the oldest. Here, someone standing at the counter matters more than someone who ordered from their car.',
      real: 'Production systems label requests by how critical they are: a customer waiting at checkout comes before a background job. A common way to build this is one queue per priority, such as <code>line:walkin</code> and <code>line:mobile</code> in Redis, with workers checking the important one first.',
    },
  },
  {
    id: '3.2', name: 'The app takes off', budget: 60, rush: 'lesson-3-2',
    brief: `A long, steady rush: 54 customers over half an hour, and more of them use the app. The goals haven't changed. Walk-ins still wait ${WALKIN_GOAL} minutes or less, and app orders are ready within ${APP_GOAL}. "Walk-ins first" worked last time. Run it and see what happens to the app rail.`,
    start: { baristas: 3, rail: true, capacity: Infinity, policy: 'walkin', mobileEvery: 4 },
    policies: ['fifo', 'walkin', 'mobile', 'weighted'],
    goals,
    concept: {
      term: 'Starvation and fair share',
      body: 'Strict priority has a catch. When high-priority work keeps arriving, low-priority work can wait almost forever. That is called starvation. A fair-share rule guarantees every queue a slice of the workers, so the important queue still goes first most of the time, but nothing waits forever.',
      real: 'This is <strong>weighted fair queuing</strong>. Network routers use it to share a link, and Kubernetes itself uses it: its API Priority and Fairness feature keeps one noisy client from locking everyone else out of the cluster.',
    },
  },
];

// Parts from later lessons, shown as locked cards so players see what's coming.
export const LOCKED = [
  { name: 'Batch the milk', sys: 'Batching', lesson: 'Lesson 4' },
  { name: 'More baristas on demand', sys: 'Autoscaling', lesson: 'Lesson 5' },
  { name: 'Second register', sys: 'Load balancer', lesson: 'Later' },
  { name: 'Pastry case', sys: 'Cache', lesson: 'Lesson 8' },
];

const w = s => s.walkin.longestWaitMin.toFixed(1);
const m = s => s.mobile.longestWaitMin.toFixed(1);

// What happened, in system design terms. s.ok is whether every goal was met.
LEVELS[0].explain = (d, s) => {
  if (s.ok) return `Baristas always checked the walk-in rail first, so the people standing in your shop waited at most <strong>${w(s)} minutes</strong>. App orders waited longer, <strong>${m(s)} minutes</strong>, but still inside their goal. Different customers, different promises, one set of baristas.`;
  if (d.policy === 'fifo') return `Oldest ticket first sounds fair, but a burst of app tickets got in line ahead of people standing at the counter. Walk-ins waited up to <strong>${w(s)} minutes</strong>. When some work is more urgent, the order it arrived in isn't the right order to do it.`;
  if (d.policy === 'mobile') return `App orders flew out in ${m(s)} minutes, but the people standing in your shop waited up to <strong>${w(s)} minutes</strong>. You prioritized the customers who could afford to wait.`;
  return `Walk-ins came first, but with ${d.baristas} barista${d.baristas > 1 ? 's' : ''} there wasn't enough time left over for the app rail: app orders waited <strong>${m(s)} minutes</strong>.`;
};
LEVELS[1].explain = (d, s) => {
  if (s.ok) return `Every ${d.mobileEvery}${d.mobileEvery === 2 ? 'nd' : d.mobileEvery === 3 ? 'rd' : 'th'} drink came from the app rail, so walk-ins still mostly went first (longest wait <strong>${w(s)} minutes</strong>) and app orders were never stuck (longest <strong>${m(s)} minutes</strong>). That's a fair share: priority without starvation.`;
  if (d.policy === 'walkin') return `Walk-ins were great: at most ${w(s)} minutes. But they never stopped coming, so the app rail only moved when the walk-in rail was empty. Some app orders waited <strong>${m(s)} minutes</strong>. That's <strong>starvation</strong>: strict priority let one queue lock out the other.`;
  if (d.policy === 'fifo') return `Oldest first treated everyone the same, so walk-ins waited up to <strong>${w(s)} minutes</strong>, past their goal. You need something between "always walk-ins" and "strictly in order".`;
  if (d.policy === 'mobile') return `App orders first starves the people standing in your shop: walk-ins waited up to <strong>${w(s)} minutes</strong>.`;
  if (s.walkin.longestWaitMin > WALKIN_GOAL) return `Every ${d.mobileEvery}${d.mobileEvery === 2 ? 'nd' : d.mobileEvery === 3 ? 'rd' : 'th'} drink from the app gave the app rail too big a share: walk-ins waited up to <strong>${w(s)} minutes</strong>. Try giving the app rail a smaller slice.`;
  return `The app rail didn't get enough of a share: app orders waited up to <strong>${m(s)} minutes</strong>. Try taking app tickets more often.`;
};

// Your call: one question before each rush, and a stretch star. See starsFor in common.mjs.
const both = s => `walk-ins ${s.walkin.longestWaitMin.toFixed(1)} min, app ${s.mobile.longestWaitMin.toFixed(1)} min`;
LEVELS[0].predict = {
  q: () => 'Whose longest wait will be longer?',
  options: [
    { label: 'Walk-ins', test: s => s.walkin.longestWaitMin > s.mobile.longestWaitMin + 3 },
    { label: 'App orders', test: s => s.mobile.longestWaitMin > s.walkin.longestWaitMin + 3 },
    { label: 'About the same', test: () => true },
  ],
  actual: both,
};
LEVELS[0].stretch = solveIn(3);
LEVELS[1].predict = {
  q: () => 'How long will the slowest app order wait?',
  options: [
    { label: 'Under 20 minutes', test: s => s.mobile.longestWaitMin < 20 },
    { label: '20 to 40 minutes', test: s => s.mobile.longestWaitMin <= 40 },
    { label: 'Over 40 minutes', test: () => true },
  ],
  actual: s => `longest app wait ${s.mobile.longestWaitMin.toFixed(1)} min`,
};
LEVELS[1].stretch = { label: 'Walk-ins wait 11 minutes or less', ok: s => s.walkin.longestWaitMin <= 11 };
