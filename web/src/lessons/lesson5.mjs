// Lesson 5, calling in more baristas: autoscaling.
// Baristas are paid by the minute ($18 an hour, config.labor), and each call-in pays at
// least a 15-minute shift. An auto-scale rule calls one in when the tickets waiting pass
// a number per barista, and sends one home after a cooldown of being idle.
import { COST, designCost, evaluate, solveIn } from './common.mjs';

export { COST, designCost, evaluate };

const wait = s => s.longestWaitMin.toFixed(1);
const pay = s => `$${s.labor.toFixed(2)}`;
const BASE = { rail: true, capacity: Infinity, payByMinute: true, maxCrew: 4, scaleDelay: 0, cooldown: 180 };

const waitGoal = limit => ({
  live: { kind: 'wait', limit }, label: `Nobody waits more than ${limit} minutes`,
  got: s => `longest ${wait(s)} min`, ok: s => s.longestWaitMin <= limit,
});
const laborGoal = limit => ({
  live: { kind: 'atMost', of: 'labor', limit }, label: `Labor costs $${limit} or less`,
  got: s => `${pay(s)} in pay`, ok: s => s.labor <= limit,
});

export const LEVELS = [
  {
    id: '5.1', name: 'Call someone in', budget: Infinity, rush: 'lesson-5-1',
    brief: 'A quiet start, a 10-minute rush, then quiet again. Baristas are paid by the minute.',
    start: { ...BASE, baristas: 2, autoscale: false, scaleAt: 2 },
    controls: ['baristas', 'autoscale'],
    goals: [waitGoal(20), laborGoal(45)],
    concept: { term: 'Autoscaling', body: '', real: '' },
  },
  {
    id: '5.2', name: 'They take time to arrive', budget: Infinity, rush: 'lesson-5-1',
    brief: 'The same morning, but a called-in barista takes 6 minutes to get there.',
    start: { ...BASE, baristas: 1, autoscale: true, scaleAt: 3, scaleDelay: 360 },
    controls: ['baristas', 'scaleAt'],
    goals: [waitGoal(20), laborGoal(43)],
    concept: { term: 'Scale-up delay', body: '', real: '' },
  },
  {
    id: '5.3', name: 'Sent home too soon', budget: Infinity, rush: 'lesson-5-3',
    brief: 'Four bursts of customers with quiet gaps between them. How long should an idle barista wait before going home?',
    start: { ...BASE, baristas: 1, autoscale: true, scaleAt: 1, scaleDelay: 180, cooldown: 0 },
    controls: ['cooldown'],
    goals: [waitGoal(10), laborGoal(45)],
    concept: { term: 'Cooldown', body: '', real: '' },
  },
];

export const LOCKED = [];

LEVELS[0].explain = (d, s) => {
  if (!d.autoscale && s.longestWaitMin > 20) return `${d.baristas} barista${d.baristas > 1 ? 's' : ''} all morning cost ${pay(s)}, but the rush still piled up: the longest wait was <strong>${wait(s)} minutes</strong>. A crew big enough for the rush sits idle the rest of the time.`;
  if (!d.autoscale) return `${d.baristas} baristas kept up with the rush, but they were paid all morning, quiet stretches too: <strong>${pay(s)}</strong>. What if you only paid for help while the line was long?`;
  return `Calling baristas in as the line grew put up to ${s.peakCrew} on the bar during the rush, and they went home when it quieted down. Longest wait <strong>${wait(s)} minutes</strong>, for <strong>${pay(s)}</strong> in pay. That's autoscaling: capacity that follows the work.`;
};
LEVELS[1].explain = (d, s) => {
  if (s.ok) return `Starting with ${d.baristas} and calling help in at ${d.scaleAt} ticket${d.scaleAt > 1 ? 's' : ''} per barista covered the 6 minutes it takes help to arrive. Longest wait <strong>${wait(s)} minutes</strong>, labor <strong>${pay(s)}</strong>.`;
  if (s.labor > 43) return `Plenty of baristas, but ${pay(s)} in pay. A bigger minimum crew is paid all morning, rush or not.`;
  return `The rule called help in, but each barista took 6 minutes to arrive, and the line kept growing meanwhile: <strong>${wait(s)} minutes</strong> at worst. Call sooner (fewer tickets per barista), or keep one more on from the start.`;
};
LEVELS[2].explain = (d, s) => {
  const m = d.cooldown / 60;
  if (s.ok) return `Waiting ${m} minute${m === 1 ? '' : 's'} before sending a barista home meant ${s.callIns} call-ins and <strong>${pay(s)}</strong> in pay. Long enough to ride out a short lull, short enough not to pay for standing around.`;
  if (d.cooldown < 120) return `Baristas went home the moment the line was empty, and the next burst called them right back: <strong>${s.callIns} call-ins</strong>, each paying at least 15 minutes. ${pay(s)} in all. That's flapping.`;
  return `Baristas stayed ${m} minutes after every burst, paid to wait for customers who weren't coming: <strong>${pay(s)}</strong>. Shorter, but not so short they're called straight back.`;
};

// Your call, and the stretch star.
LEVELS[0].predict = {
  q: () => 'How many baristas will be working at the busiest moment?',
  options: [
    { label: 'The ones I start with', test: (s, d) => s.peakCrew <= d.baristas },
    { label: 'One or two more', test: s => s.peakCrew < 4 },
    { label: 'All four', test: () => true },
  ],
  actual: s => `${s.peakCrew} at the busiest moment`,
};
LEVELS[0].stretch = { label: 'Labor $40 or less', ok: s => s.labor <= 40 };
LEVELS[1].predict = {
  q: () => 'Help takes 6 minutes to arrive. How long will the longest wait be?',
  options: [
    { label: '20 minutes or less', test: s => s.longestWaitMin <= 20 },
    { label: '20 to 22', test: s => s.longestWaitMin <= 22 },
    { label: 'Over 22', test: () => true },
  ],
  actual: s => `longest ${wait(s)} min`,
};
LEVELS[1].stretch = solveIn(3);
LEVELS[2].predict = {
  q: () => 'How many times will you call a barista in?',
  options: [
    { label: 'Up to 4', test: s => s.callIns <= 4 },
    { label: '5 to 8', test: s => s.callIns <= 8 },
    { label: 'More than 8', test: () => true },
  ],
  actual: s => `${s.callIns} call-ins`,
};
LEVELS[2].stretch = { label: 'Labor $41 or less', ok: s => s.labor <= 41 };

// ---------- The brief ----------
const SOFT = '<p class="brief-soft"><span class="slo">IN SOFTWARE</span>';

LEVELS[0].intro = [
  {
    stub: 'The situation', title: 'Paid by the minute',
    html: `<p>A quiet start, then the office crowd: 36 customers in ten minutes. Then quiet again.</p>
      <p>From today, baristas are paid by the minute, $18 an hour. A barista standing around during the quiet stretch costs the same as one making drinks in the rush.</p>`,
  },
  {
    stub: 'The idea', title: 'Call someone in',
    html: `<p>Real shops don't keep a full crew all day. When the line gets long, the manager <strong>calls someone in</strong>; when it's quiet, someone goes home.</p>
      <p>That's <strong>autoscaling</strong>: the number of workers follows the amount of work, so you pay for capacity only while you need it.</p>
      ${SOFT}Kubernetes adds and removes copies of a program (Pods) automatically. Rush Hour's real cluster can scale baristas on the length of the line, which is what KEDA does with a Redis queue.</p>`,
  },
  {
    stub: 'Your job', title: 'Fast, and not too expensive',
    html: `<p>Nobody waits more than <strong>20 minutes</strong>, and labor stays at <strong>$45</strong> or less.</p>
      <p>Try a fixed crew first, then turn on <em>Call in baristas</em>. With it on, your crew number is the minimum, and up to four can be working at once.</p>`,
  },
];
LEVELS[1].intro = [{
  stub: "What's new", title: 'Help takes time to arrive',
  html: `<p>Same morning, but a barista you call in takes <strong>6 minutes</strong> to get there. The line doesn't wait for them.</p>
    <p>Two ways to cover the gap: call for help <strong>earlier</strong> (at fewer tickets per barista), or keep a bigger <strong>minimum crew</strong> on from the start. Goals: nobody over <strong>20 minutes</strong>, labor <strong>$43</strong> or less.</p>
    ${SOFT}A new Pod has to start before it can work: download the program, boot it, pass its health check. Autoscalers react to load that's already there, so teams scale early or keep spare capacity.</p>`,
}];
LEVELS[2].intro = [{
  stub: "What's new", title: 'Sent home too soon',
  html: `<p>Four bursts of customers today, with quiet six-minute gaps. Help takes 3 minutes to arrive, and every call-in is paid for at least <strong>15 minutes</strong>, however short the shift.</p>
    <p>Send an idle barista home the moment the line is empty, and the next burst calls them straight back. Keep them too long, and you pay them to stand around. The <strong>cooldown</strong> is how long they wait before going home. Goal: labor <strong>$45</strong> or less.</p>
    ${SOFT}Scaling down too fast and straight back up is called <b>flapping</b>. Kubernetes' autoscaler waits five minutes by default before removing Pods (a stabilization window) for exactly this reason.</p>`,
}];

// ---------- Aha moments ----------
export const MOMENTS = [
  {
    id: 'clock-in', on: 'clockIn', level: '5.1', spot: 'bar', title: 'Help arrived',
    text: ({ run }) => `The line got long, so you called someone in. They're on the bar now, and ${run.rail.length} ticket${run.rail.length === 1 ? ' is' : 's are'} waiting.`,
    soft: 'That\'s <b>scaling out</b>: adding a worker when the queue grows. In Kubernetes, the autoscaler adds a Pod.',
  },
  {
    id: 'on-the-way', on: 'goalRisk', level: '5.2', goal: 0, spot: 'rail', title: 'Help is on the way',
    text: ({ run }) => {
      const coming = run.baristas.filter(b => b.arriving).length;
      return coming ? `${coming} barista${coming > 1 ? 's are' : ' is'} on the way, but still minutes away, and ${run.rail.length} tickets are waiting.` : `${run.rail.length} tickets are waiting, and the help you called is only just arriving.`;
    },
    soft: 'Scaling takes time: a new <b>Pod</b> has to start before it can work. Scale earlier, or keep enough workers ready.',
  },
  {
    id: 'flapping', on: 'clockOut', level: '5.3', spot: 'bar', when: ({ d }) => d.cooldown < 120, title: 'Sent home already',
    text: () => 'The line was empty, so a barista went straight home. The next burst will call them right back, and every call-in pays at least 15 minutes.',
    soft: 'That\'s <b>flapping</b>: scaling down too fast, then straight back up. A <b>cooldown</b> waits before removing workers.',
  },
];
