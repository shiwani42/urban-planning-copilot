import type { AnalysisResult, Candidate } from "./types";
import type { StoredCandidate } from "./store-persistence";

/** Placeholder geometry type — full parcel polygons live in featuresByDataset. */
export const COMPACT_GEOMETRY_MARKER = "__compact__" as const;

export function isCompactCandidate(candidate: Candidate): boolean {
  const geometry = candidate.geometry as GeoJSON.Geometry & { type?: string };
  return (
    geometry?.type === "Point" &&
    Array.isArray((geometry as GeoJSON.Point).coordinates) &&
    (candidate.provenance?.calculations?.length ?? 0) === 0
  );
}

export function compactCandidateForStore(candidate: Candidate): StoredCandidate {
  const { geometry: _geometry, provenance: _provenance, centroid, ...rest } = candidate;
  const metrics = Array.isArray(rest.metrics) ? rest.metrics : [];
  const scoreBreakdown = candidate.provenance?.scoreBreakdown ?? {};
  const slimMetrics =
    metrics.length > 0
      ? metrics
      : Object.entries(scoreBreakdown).map(([key, value]) => ({
          key: key.endsWith("_score") ? key : `${key}_score`,
          label: key,
          value,
          kind: "calculated" as const,
        }));
  return {
    ...rest,
    metrics: slimMetrics,
    ...(centroid ? { centroid } : {}),
  };
}

export function scoreStatsFromCandidates(
  candidates: Array<Pick<Candidate, "score">>
): { scoreMin?: number; scoreMax?: number; scoreSpread: number } {
  const scores = candidates.map((c) => c.score).filter((s) => Number.isFinite(s));
  if (!scores.length) {
    return { scoreSpread: 0 };
  }
  const scoreMin = Math.min(...scores);
  const scoreMax = Math.max(...scores);
  return {
    scoreMin,
    scoreMax,
    scoreSpread: Number((scoreMax - scoreMin).toFixed(1)),
  };
}

export function applyScoreStatsToResult(
  result: AnalysisResult,
  candidates: Array<Pick<Candidate, "score">>
): void {
  const stats = scoreStatsFromCandidates(candidates);
  result.candidateCount = candidates.length;
  result.scoreMin = stats.scoreMin;
  result.scoreMax = stats.scoreMax;
  result.scoreSpread = stats.scoreSpread;
}

export function resultScoreSpread(result: AnalysisResult): number {
  if (typeof result.scoreSpread === "number" && Number.isFinite(result.scoreSpread)) {
    return result.scoreSpread;
  }
  return scoreStatsFromCandidates(result.candidates).scoreSpread;
}

export function resultCandidateCount(result: AnalysisResult): number {
  if (typeof result.candidateCount === "number" && Number.isFinite(result.candidateCount)) {
    return result.candidateCount;
  }
  return Array.isArray(result.candidates) ? result.candidates.length : 0;
}

/** Keep only the scenario's latestResultId row — drops duplicate completed blobs. */
export function dedupeAnalysisResultsPerScenario(store: {
  scenarios: Array<{ id: string; latestResultId?: string | null }>;
  analysisResults: AnalysisResult[];
}): boolean {
  let changed = false;
  for (const scenario of store.scenarios) {
    const keepId = scenario.latestResultId;
    if (!keepId) continue;
    const before = store.analysisResults.length;
    store.analysisResults = store.analysisResults.filter(
      (r) => r.scenarioId !== scenario.id || r.id === keepId
    );
    if (store.analysisResults.length !== before) changed = true;
  }
  return changed;
}
