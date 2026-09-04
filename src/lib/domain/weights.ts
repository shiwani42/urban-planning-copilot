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

export function weightsEqual(a: CriterionWeight[], b: CriterionWeight[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (w, i) =>
      w.id === b[i].id &&
      w.key === b[i].key &&
      Math.round(w.weight * 100) === Math.round(b[i].weight * 100)
  );
}

function cloneWeights(weights: CriterionWeight[]): CriterionWeight[] {
  return weights.map((w) => ({ ...w }));
}

export type WeightDraftSyncState = {
  scenarioId: string;
  serverWeights: CriterionWeight[];
};

/** Keep unsaved slider edits when workspace refresh bumps scenario.updatedAt. */
export function mergeWeightDraftFromServer(
  prev: CriterionWeight[] | null,
  scenarioId: string,
  serverWeights: CriterionWeight[],
  sync: WeightDraftSyncState | null
): { draft: CriterionWeight[]; sync: WeightDraftSyncState } {
  const nextSync = { scenarioId, serverWeights };
  if (!sync || sync.scenarioId !== scenarioId) {
    return { draft: cloneWeights(serverWeights), sync: nextSync };
  }
  if (weightsEqual(sync.serverWeights, serverWeights)) {
    return { draft: prev ?? cloneWeights(serverWeights), sync };
  }
  if (!prev) {
    return { draft: cloneWeights(serverWeights), sync: nextSync };
  }
  const dirty = !weightsEqual(prev, sync.serverWeights);
  return {
    draft: dirty ? prev : cloneWeights(serverWeights),
    sync: nextSync,
  };
}

const FLOOD_WEIGHT_KEY_MARKERS = ["flood_resilience", "flood_exposure", "flood"];

export const FLOOD_WEIGHTED_BRANCH_FLOOD_PERCENT = 35;

export function isFloodWeightedBranchName(name: string): boolean {
  return /\bflood[- ]?weighted\b/i.test(name.trim());
}

function floodWeightIndex(weights: CriterionWeight[]): number {
  return weights.findIndex((weight) =>
    FLOOD_WEIGHT_KEY_MARKERS.some(
      (marker) => weight.key === marker || weight.key.includes(marker)
    )
  );
}

/** Shift criterion weights toward flood resilience (default 35% flood). */
export function applyFloodWeightedWeights(
  weights: CriterionWeight[],
  floodPercent: number = FLOOD_WEIGHTED_BRANCH_FLOOD_PERCENT
): CriterionWeight[] {
  const floodIndex = floodWeightIndex(weights);
  if (floodIndex < 0) return weights.map((weight) => ({ ...weight }));
  return rebalanceWeights(weights, floodIndex, floodPercent);
}
