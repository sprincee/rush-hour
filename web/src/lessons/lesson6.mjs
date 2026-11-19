// Lesson 6, no ordering a box of coffee during the rush: rate limiting.
// From the real shop: a box of coffee for an office ties a barista up for about
// 8 minutes, so during the rush the shop doesn't take them. The cashier applies a box
// rule at the register: take every box, none, or one per N minutes (a token bucket).
import { COST, designCost, evaluate, solveIn } from './common.mjs';

export { COST, designCost, evaluate };

const wait = s => s.longestWaitMin.toFixed(1);
const BASE = { baristas: 3, rail: true, capacity: Infinity, boxEvery: 300 };
export const BOX_RULES = { all: 'Take every box', none: 'No boxes in the rush', bucket: 'One box every few minutes' };

export const LEVELS = [
  {
    id: '6.1', name: 'Not during the rush', budget: 56, rush: 'lesson-6',
    brief: 'Offices keep ordering boxes of coffee in the middle of the rush.',
    start: { ...BASE, boxRule: 'all' },
    controls: ['boxRule'], boxRules: ['all', 'none'],
    goals: [
      { live: { kind: 'wait', limit: 15 }, label: 'Nobody waits more than 15 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 15 },
    ],
    concept: { term: 'Rate limiting', body: '', real: '' },
  },
  {
    id: '6.2', name: 'The office is a regular', budget: 56, rush: 'lesson-6',
    brief: 'Refusing every box loses the office. Let some through, but not so many that the line suffers.',
    start: { ...BASE, boxRule: 'none' },
    controls: ['boxRule', 'boxEvery'], boxRules: ['all', 'none', 'bucket'],
    goals: [
      { live: { kind: 'wait', limit: 19 }, label: 'Nobody waits more than 19 minutes', got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= 19 },
      { live: { kind: 'atMost', of: 'refusedBoxes', limit: 6 }, label: 'Refuse 6 boxes or fewer', got: s => `${s.refusedBoxes} refused`, ok: s => s.refusedBoxes <= 6 },
    ],
    concept: { term: 'Token bucket', body: '', real: '' },
  },
];

export const LOCKED = [];

LEVELS[0].explain = (d, s) => {
  if (d.boxRule === 'all') return `Every box took a barista off the line for 8 minutes. With ${s.boxesServed} boxes in the middle of the rush, the longest wait reached <strong>${wait(s)} minutes</strong>. One kind of expensive order slowed down everyone else.`;
  return `The cashier turned away ${s.refusedBoxes} box orders during the rush, so all three baristas stayed on drinks: longest wait <strong>${wait(s)} minutes</strong>. That's the real shop's rule, and it's rate limiting: a cap on one expensive kind of request.`;
};
LEVELS[1].explain = (d, s) => {
  if (d.boxRule === 'none') return `No boxes at all kept the line moving, but the office was refused <strong>${s.refusedBoxes} times</strong>. They'll take their order somewhere else.`;
  if (d.boxRule === 'all') return `Every box was taken, and the line paid for it: <strong>${wait(s)} minutes</strong> at worst.`;
  const m = d.boxEvery / 60;
  if (s.ok) return `One box every ${m} minutes let ${s.boxesServed} boxes through and refused ${s.refusedBoxes}, with the longest wait at <strong>${wait(s)} minutes</strong>. That's a token bucket: a steady allowance, not a hard no.`;
  if (s.longestWaitMin > 19) return `One box every ${m} minutes let ${s.boxesServed} through, which was too many for the line: <strong>${wait(s)} minutes</strong>. Refill the bucket more slowly.`;
  return `One box every ${m} minutes was so strict that ${s.refusedBoxes} were refused. Refill the bucket a little faster.`;
};

LEVELS[0].predict = {
  q: d => (d.boxRule === 'all' ? 'Taking every box, how long will the longest wait be?' : 'With no boxes in the rush, how long will the longest wait be?'),
  options: [
    { label: 'Under 15 minutes', test: s => s.longestWaitMin < 15 },
    { label: '15 to 25', test: s => s.longestWaitMin <= 25 },
    { label: 'Over 25', test: () => true },
  ],
  actual: s => `longest ${wait(s)} min`,
};
LEVELS[0].stretch = solveIn(3);
LEVELS[1].predict = {
  q: () => 'How many box orders will be refused?',
  options: [
    { label: '0 to 3', test: s => s.refusedBoxes <= 3 },
    { label: '4 to 6', test: s => s.refusedBoxes <= 6 },
    { label: '7 or more', test: () => true },
  ],
  actual: s => `${s.refusedBoxes} refused`,
};
LEVELS[1].stretch = { label: 'Nobody waits more than 17½ minutes', ok: s => s.longestWaitMin <= 17.5 };

// ---------- The brief ----------
const SOFT = '<p class="brief-soft"><span class="slo">IN SOFTWARE</span>';

LEVELS[0].intro = [
  {
    stub: 'The situation', title: 'A box of coffee',
    html: `<p>36 customers in 15 minutes, and three baristas. But about one order in five is an office asking for a <strong>box of coffee</strong>: enough for a whole meeting.</p>
      <p>A box ties one barista up for about <strong>8 minutes</strong>. In the middle of a rush, that's a third of your bar gone.</p>`,
  },
  {
    stub: 'The idea', title: 'Not during the rush',
    html: `<p>At a real counter the rule is simple: <strong>no boxes of coffee during the rush</strong>. The office can have one later, just not now.</p>
      <p>That's <strong>rate limiting</strong>: capping how often an expensive kind of request is accepted, so it can't crowd out everyone else.</p>
      ${SOFT}APIs refuse extra requests with <b>429 Too Many Requests</b>, often per customer or per kind of call. The client is told to try again later.</p>`,
  },
  {
    stub: 'Your job', title: 'Keep the line moving',
    html: `<p>Nobody waits more than <strong>15 minutes</strong>. Your crew is set; choose the cashier's <em>box rule</em>.</p>
      <p>During the rush, watch what a box does to one barista, and to the line behind it.</p>`,
  },
];
LEVELS[1].intro = [{
  stub: "What's new", title: 'The office is a regular',
  html: `<p>Refusing every box worked, but the office is a regular, and they're getting annoyed. Refuse <strong>6 boxes or fewer</strong>, and still keep everyone under <strong>19 minutes</strong>.</p>
    <p>A new rule: <strong>one box every few minutes</strong>. Think of a jar with one token in it. A box takes the token; the jar refills one token every few minutes. No token, no box. That's a <strong>token bucket</strong>: a steady allowance instead of a flat no.</p>
    ${SOFT}Token buckets are how most rate limiters work, from Amazon API Gateway's throttling to the limits on public APIs: a burst is allowed, then a steady rate.</p>`,
}];

// ---------- Aha moments ----------
export const MOMENTS = [
  {
    id: 'box-busy', on: 'goalRisk', level: '6.1', goal: 0, spot: 'bar', when: ({ d }) => d.boxRule === 'all', title: 'Tied up on a box',
    text: ({ run }) => {
      const boxes = run.baristas.filter(b => b.ticket && run.menu[b.ticket.item].box).length;
      return `${boxes ? `${boxes} barista${boxes > 1 ? 's are' : ' is'} making a box of coffee` : 'Boxes of coffee have tied up your baristas'}, and ${run.rail.length} tickets are waiting behind ${boxes > 1 ? 'them' : 'it'}.`;
    },
    soft: 'One expensive kind of request can starve everyone else. <b>Rate limiting</b> caps how often it\'s accepted.',
  },
  {
    id: 'box-refused', on: 'rejected', why: 'limited', level: '6.2', spot: 'register', title: 'Not right now',
    text: ({ d }) => (d.boxRule === 'bucket' ? 'The office asks for another box, but the token jar is empty, so the cashier says "not right now".' : 'The office asks for a box, and the cashier says "not during the rush".'),
    soft: 'That\'s a <b>429 Too Many Requests</b>: the client is told to try later. A token bucket refills a token every few minutes.',
  },
];
