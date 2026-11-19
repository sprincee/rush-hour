// Lesson 7, line out the door, pause mobile orders: backpressure.
// From the real shop: when the line is out the door, the manager pauses mobile ordering
// instead of promising drinks the bar can't make in time. Here the app stops taking
// orders while the rails hold a set number of tickets.
import { COST, designCost, evaluate, solveIn } from './common.mjs';

export { COST, designCost, evaluate };

const BASE = { baristas: 3, rail: true, capacity: Infinity, policy: 'fifo', pauseAt: 10 };
const app = s => s.mobile.longestWaitMin.toFixed(1);
const walk = s => s.walkin.longestWaitMin.toFixed(1);

const goals = [
  { live: { kind: 'wait', limit: 12, channel: 'mobile' }, label: 'App orders ready within 12 minutes', got: s => `longest ${app(s)} min`, ok: s => s.mobile.longestWaitMin <= 12 },
  { live: { kind: 'wait', limit: 14, channel: 'walkin' }, label: 'Walk-ins wait 14 minutes or less', got: s => `longest ${walk(s)} min`, ok: s => s.walkin.longestWaitMin <= 14 },
];

export const LEVELS = [
  {
    id: '7.1', name: 'Line out the door', budget: 56, rush: 'lesson-7',
    brief: 'Half today\'s customers order in the app, and the app takes every order, however long the line is.',
    start: { ...BASE, pause: false },
    controls: ['pause', 'pauseAt'],
    goals,
    concept: { term: 'Backpressure', body: '', real: '' },
  },
  {
    id: '7.2', name: 'Pause, but not too soon', budget: 56, rush: 'lesson-7',
    brief: 'Every refused app order is a customer who went somewhere else.',
    start: { ...BASE, pause: true, pauseAt: 4 },
    controls: ['pause', 'pauseAt'],
    goals: [
      ...goals,
      { live: { kind: 'atMost', of: 'appRefused', limit: 6 }, label: 'Refuse 6 app orders or fewer', got: s => `${s.appRefused} refused`, ok: s => s.appRefused <= 6 },
    ],
    concept: { term: 'Backpressure threshold', body: '', real: '' },
  },
];

export const LOCKED = [];

LEVELS[0].explain = (d, s) => {
  if (!d.pause) return `The app said yes to every order, even with the line out the door. App customers waited up to <strong>${app(s)} minutes</strong> and walk-ins <strong>${walk(s)}</strong>. Accepting work you can't finish in time makes everyone late.`;
  return `The app paused whenever ${d.pauseAt} tickets were waiting, and refused ${s.appRefused} orders. Everyone it did take was on time: app orders within <strong>${app(s)} minutes</strong>, walk-ins <strong>${walk(s)}</strong>. That's backpressure: a full system tells new work to wait.`;
};
LEVELS[1].explain = (d, s) => {
  if (!d.pause) return `No pause, so nobody was refused, but app orders took up to <strong>${app(s)} minutes</strong>.`;
  if (s.ok) return `Pausing at ${d.pauseAt} tickets refused only ${s.appRefused} app orders and kept everyone on time. Push back when you must, and no sooner.`;
  if (s.appRefused > 6) return `Pausing at ${d.pauseAt} tickets kept the bar comfortable, but refused <strong>${s.appRefused} app orders</strong> it could have made. Pause later.`;
  return `Pausing at ${d.pauseAt} tickets let too much in: app orders took up to <strong>${app(s)} minutes</strong>. Pause a little sooner.`;
};

LEVELS[0].predict = {
  q: () => 'How long will the slowest app order take?',
  options: [
    { label: 'Under 12 minutes', test: s => s.mobile.longestWaitMin <= 12 },
    { label: '12 to 20', test: s => s.mobile.longestWaitMin <= 20 },
    { label: 'Over 20', test: () => true },
  ],
  actual: s => `longest app order ${app(s)} min`,
};
LEVELS[0].stretch = { label: 'Refuse 9 app orders or fewer', ok: s => s.appRefused <= 9 };
LEVELS[1].predict = {
  q: () => 'How many app orders will be refused?',
  options: [
    { label: '0 to 6', test: s => s.appRefused <= 6 },
    { label: '7 to 10', test: s => s.appRefused <= 10 },
    { label: 'More than 10', test: () => true },
  ],
  actual: s => `${s.appRefused} refused`,
};
LEVELS[1].stretch = solveIn(3);

// ---------- The brief ----------
const SOFT = '<p class="brief-soft"><span class="slo">IN SOFTWARE</span>';

LEVELS[0].intro = [
  {
    stub: 'The situation', title: 'The app keeps saying yes',
    html: `<p>40 customers in 20 minutes, and half of them order in the app. Three baristas.</p>
      <p>The app doesn't know the line is out the door. It takes every order and promises a drink in a few minutes, then the customer walks in and waits like everyone else.</p>`,
  },
  {
    stub: 'The idea', title: 'Pause mobile orders',
    html: `<p>When the line is out the door, a real shop <strong>pauses mobile ordering</strong>. The app shows "ordering paused" instead of taking an order the bar can't make in time.</p>
      <p>That's <strong>backpressure</strong>: a system that's full tells whoever sends it work to slow down, instead of accepting everything and falling behind.</p>
      ${SOFT}A busy service answers <b>503</b> with a "try again later", or a queue stops handing out work when it's too deep. The rest of the system stays fast for the requests already accepted.</p>`,
  },
  {
    stub: 'Your job', title: 'On time for everyone you accept',
    html: `<p>App orders ready within <strong>12 minutes</strong>, and walk-ins served within <strong>14</strong>. Your crew is set.</p>
      <p>Turn on <em>Pause the app</em> and choose how many waiting tickets trigger it. During the rush, watch the app rail.</p>`,
  },
];
LEVELS[1].intro = [{
  stub: "What's new", title: 'Pause, but not too soon',
  html: `<p>Every app order you refuse is a customer who bought coffee somewhere else. Today, refuse <strong>6 or fewer</strong>, and still keep everyone on time.</p>
    <p>Pause too early and you turn away orders the bar could have made. Pause too late and the orders you took are late. The <strong>threshold</strong> is the trade-off.</p>
    ${SOFT}Backpressure thresholds are tuned like this in real systems: queue depth, lag, or response time, set high enough to stay busy and low enough to stay on time.</p>`,
}];

// ---------- Aha moments ----------
export const MOMENTS = [
  {
    id: 'app-yes', on: 'goalRisk', level: '7.1', goal: 0, spot: 'appRail', when: ({ d }) => !d.pause, title: 'The app keeps saying yes',
    text: ({ run }) => `${run.mobileRail.length} app orders are waiting, ${run.rail.length} walk-in tickets too, and the app is still taking more.`,
    soft: 'Accepting work you can\'t finish in time makes everyone late. <b>Backpressure</b> pushes back on new work when the system is full.',
  },
  {
    id: 'paused', on: 'rejected', why: 'paused', level: '7.1', spot: 'appPrinter', title: 'Ordering paused',
    text: ({ run, c }) => `${run.rail.length + run.mobileRail.length} tickets are waiting, so the app tells customer ${c.id} "ordering paused".`,
    soft: 'The system says no early (<b>503</b>, try later), so the orders it already took stay on time.',
  },
];
