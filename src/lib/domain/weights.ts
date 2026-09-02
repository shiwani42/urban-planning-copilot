import type { CriterionWeight } from "./types";

/** Rebalance criterion weights to sum to 1, keeping the changed slider fixed. */
export function rebalanceWeights(
  weights: CriterionWeight[],
  changedIndex: number,
  newPercent: number
): CriterionWeight[] {
  if (weights.length === 0) return weights;
  const clamped = Math.max(0, Math.min(100, Math.round(newPercent)));
  const next = weights.map((w) => ({ ...w }));
  next[changedIndex] = { ...next[changedIndex], weight: clamped / 100 };
  const otherIndices = next.map((_, i) => i).filter((i) => i !== changedIndex);
  if (otherIndices.length === 0) {
    next[changedIndex].weight = 1;
    return next;
  }
  const remaining = 1 - next[changedIndex].weight;
  const otherSum = otherIndices.reduce((s, i) => s + next[i].weight, 0);
  if (remaining <= 0) {
    for (const i of otherIndices) next[i].weight = 0;
    next[changedIndex].weight = 1;
    return next;
  }
  if (otherSum <= 0) {
    const even = remaining / otherIndices.length;
    for (const i of otherIndices) next[i].weight = even;
    return next;
  }
  for (const i of otherIndices) {
    next[i].weight = (next[i].weight / otherSum) * remaining;
  }
  return next;
}

export function weightSumPercent(weights: CriterionWeight[]): number {
  return Math.round(weights.reduce((sum, w) => sum + w.weight, 0) * 100);
}
