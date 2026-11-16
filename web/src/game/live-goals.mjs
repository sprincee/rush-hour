// Live goal meters: how each goal is doing while the rush runs. Pure functions of the
// engine's run state, so tests can check them against the final verdict.
//
// Each goal in a lesson file has a `live` description:
//   { kind: 'wait', limit: 40 }                    longest wait, in shop minutes
//   { kind: 'wait', limit: 15, channel: 'walkin' } the same, for one channel
//   { kind: 'answer', limit: 2 }                   longest time to an answer at the register
//   { kind: 'atMost', of: 'rejected', limit: 25 }  a count that must stay at or under a limit
//   { kind: 'atMost', of: 'steams', limit: 9 }
//   { kind: 'serveAll' }                           nobody turned away
//
// Statuses: 'ok' (on track), 'risk' (75% of the way to the limit), 'missed' (can no longer
// be met), and at the end of the rush 'met'. A goal never comes back from 'missed'.

export const RISK_AT = 0.75;

const COUNT_LABELS = { rejected: 'turned away', steams: 'pitchers' };
const SHORT = {
  rejected: limit => `Turned away ≤ ${limit}`,
  steams: limit => `Pitchers ≤ ${limit}`,
};

/** A short label for the strip under the shop: "Wait ≤ 40 min". */
export function shortLabel(live) {
  if (live.kind === 'wait') {
    const who = live.channel === 'walkin' ? 'Walk-in wait' : live.channel === 'mobile' ? 'App wait' : 'Wait';
    return `${who} ≤ ${live.limit} min`;
  }
  if (live.kind === 'answer') return `Answer ≤ ${live.limit} min`;
  if (live.kind === 'atMost') return SHORT[live.of](live.limit);
  return 'Serve everyone';
}

// Someone still waiting for a drink, and how long they've waited so far (seconds).
// People in the register line only count when they can't be turned away later, so the
// meter never calls a goal missed because of someone who then walks out.
function waitingSoFar(run, channel) {
  const design = run.design;
  const lineIsSafe = design.rail && !Number.isFinite(design.capacity);
  let longest = 0;
  for (const c of run.customers) {
    if (channel && c.channel !== channel) continue;
    const ordered = c.state === 'waiting';
    const inLine = (c.state === 'queue' || c.state === 'ordering') && lineIsSafe;
    if (!ordered && !inLine) continue;
    const from = c.channel === 'mobile' ? c.orderedAt : c.arriveAt;
    longest = Math.max(longest, run.t - from);
  }
  return longest;
}

// Walk-ins who've arrived but don't have an answer yet: still in line, or (sync) waiting at the bar.
function unansweredSoFar(run) {
  let longest = 0;
  for (const c of run.customers) {
    if (c.channel !== 'walkin' || c.answeredAt !== undefined) continue;
    if (c.state !== 'queue' && c.state !== 'ordering' && c.state !== 'waiting') continue;
    longest = Math.max(longest, run.t - c.arriveAt);
  }
  return longest;
}

function answeredLongest(run) {
  let longest = 0;
  for (const c of run.customers) {
    if (c.channel === 'walkin' && c.answeredAt !== undefined) longest = Math.max(longest, c.answeredAt - c.arriveAt);
  }
  return longest;
}

/**
 * How a goal is doing right now.
 * @returns {{ status: 'ok'|'risk'|'missed'|'met', fill: number, mark: number|null, text: string }}
 *   fill: how full the meter is (0-1). mark: where the limit line sits on the meter, if any.
 */
export function liveGoal(live, run, finished = false) {
  // Meters reach the limit line at 80%, leaving room to show a goal going over.
  const MARK = 0.8;
  const meter = (value, limit) => Math.min(1, (value / Math.max(limit, 1e-9)) * MARK);
  const judge = (value, limit) => (value > limit ? 'missed' : finished ? 'met' : value >= RISK_AT * limit && limit > 0 ? 'risk' : 'ok');
  // 40.03 minutes against a 40-minute limit is missed, so never show it as "40.0 / 40".
  const minutesText = (value, limit) => `${(value > limit ? Math.max(value, limit + 0.1) : value).toFixed(1)} / ${limit} min`;

  if (live.kind === 'wait') {
    const done = live.channel ? run.byChannel[live.channel].longestWait : run.longestWait;
    const minutes = Math.max(done, finished ? 0 : waitingSoFar(run, live.channel)) / 60;
    return { status: judge(minutes, live.limit), fill: meter(minutes, live.limit), mark: MARK, text: minutesText(minutes, live.limit) };
  }
  if (live.kind === 'answer') {
    const minutes = Math.max(answeredLongest(run), finished ? 0 : unansweredSoFar(run)) / 60;
    return { status: judge(minutes, live.limit), fill: meter(minutes, live.limit), mark: MARK, text: minutesText(minutes, live.limit) };
  }
  if (live.kind === 'atMost') {
    const value = run[live.of];
    return { status: judge(value, live.limit), fill: meter(value, live.limit), mark: MARK, text: `${value} / ${live.limit} ${COUNT_LABELS[live.of]}` };
  }
  // serveAll: progress toward everyone served; missed the moment anyone is turned away.
  const total = run.customers.length;
  const status = run.rejected > 0 ? 'missed' : finished ? 'met' : 'ok';
  return { status, fill: total ? run.served / total : 0, mark: null, text: `${run.served} / ${total} served` };
}

export const STATUS_WORDS = { ok: 'ON TRACK', risk: 'AT RISK', missed: 'MISSED', met: 'MET' };
