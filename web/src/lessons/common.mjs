// Shared by every lesson: what parts cost, how a level is judged, and its stars.

export const COST = { barista: 18, rail: 2 };

export const designCost = d => d.baristas * COST.barista + (d.rail ? COST.rail : 0);

/** Did a design pass a level? Budget is checked here too, since the game blocks over-budget runs. */
export function evaluate(level, design, summary) {
  const goals = level.goals.map(g => ({ label: g.label, ok: g.ok(summary) }));
  const withinBudget = designCost(design) <= level.budget;
  return { passed: withinBudget && goals.every(g => g.ok), withinBudget, goals };
}

// ---------- Stars ----------
// Every level has three: meet the goals, meet them with the level's stretch, and call it
// (predict the outcome correctly before the rush). Stars are earned one run at a time and
// kept for the visit. The stretch only counts on a run that meets the goals.

/** A stretch for levels with room to save: meet the goals spending this much or less. */
export const spendAtMost = n => ({ label: `Meet the goals for $${n} or less`, ok: (s, d) => designCost(d) <= n });

/** A stretch for levels with one right design: find it within this many rushes. */
export const solveIn = n => ({ label: `Meet the goals in ${n} rushes or fewer`, ok: (s, d, ctx) => ctx.rushes <= n });

export const STAR_NAMES = ['Meet the goals', null, 'Called it'];

/** Which prediction came true: the index of the first option whose test passes. */
export function outcome(predict, summary, design) {
  return predict.options.findIndex(o => o.test(summary, design));
}

/**
 * The stars one run earns.
 * @param ctx { rushes: rushes run on this level so far, including this one; guess: option index or null }
 * @returns three booleans: goals met, stretch, called it.
 */
export function starsFor(level, design, summary, { rushes = 1, guess = null } = {}) {
  const met = evaluate(level, design, summary).passed;
  return [
    met,
    met && level.stretch.ok(summary, design, { rushes }),
    guess !== null && guess === outcome(level.predict, summary, design),
  ];
}

export const starLabels = level => [STAR_NAMES[0], level.stretch.label, STAR_NAMES[2]];

// Prediction answers read better as words when they're short.
export const minutes = m => (m < 1 ? `${Math.max(1, Math.round(m * 60))} seconds` : `${m.toFixed(1)} min`);
