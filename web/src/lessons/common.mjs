// Shared by every lesson: what parts cost, and how a level is judged.

export const COST = { barista: 18, rail: 2 };

export const designCost = d => d.baristas * COST.barista + (d.rail ? COST.rail : 0);

/** Did a design pass a level? Budget is checked here too, since the game blocks over-budget runs. */
export function evaluate(level, design, summary) {
  const goals = level.goals.map(g => ({ label: g.label, ok: g.ok(summary) }));
  const withinBudget = designCost(design) <= level.budget;
  return { passed: withinBudget && goals.every(g => g.ok), withinBudget, goals };
}
