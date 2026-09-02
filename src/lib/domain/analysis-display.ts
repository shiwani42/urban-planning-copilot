import { dedupeLimitations } from "../format";
import type { AnalysisResult, Candidate, CandidateProvenance, MetricValue } from "./types";

const EMPTY_PROVENANCE: CandidateProvenance = {
  scoreBreakdown: {},
  calculations: [],
  datasets: [],
  assumptions: [],
  constraints: [],
  humanDecisions: [],
  limitations: [],
};

/** Safe limitations list from an analysis result (compact persist may omit the field). */
export function analysisLimitations(result?: AnalysisResult | null): string[] {
  if (!result) return [];
  const raw = result.limitations;
  return Array.isArray(raw) ? dedupeLimitations(raw) : [];
}

/** Safe aggregate metrics from an analysis result. */
export function analysisAggregateMetrics(result?: AnalysisResult | null): MetricValue[] {
  if (!result) return [];
  return Array.isArray(result.aggregateMetrics) ? result.aggregateMetrics : [];
}

export function aggregateMetricValue(
  result: AnalysisResult | null | undefined,
  key: string
): number | undefined {
  const value = analysisAggregateMetrics(result).find((m) => m.key === key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function candidateMetrics(candidate?: Candidate | null): MetricValue[] {
  if (!candidate) return [];
  return Array.isArray(candidate.metrics) ? candidate.metrics : [];
}

export function candidateMetricValue(
  candidate: Candidate | null | undefined,
  key: string
): number | undefined {
  const value = candidateMetrics(candidate).find((m) => m.key === key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Provenance rebuilt from result limitations when compact persist stripped per-candidate blobs. */
export function candidateProvenance(
  candidate?: Candidate | null,
  resultLimitations?: string[]
): CandidateProvenance {
  const fallbackLimitations = resultLimitations ?? [];
  if (!candidate?.provenance) {
    return {
      ...EMPTY_PROVENANCE,
      limitations: [...fallbackLimitations],
    };
  }
  const p = candidate.provenance;
  return {
    scoreBreakdown:
      p.scoreBreakdown && typeof p.scoreBreakdown === "object" ? p.scoreBreakdown : {},
    calculations: Array.isArray(p.calculations) ? p.calculations : [],
    datasets: Array.isArray(p.datasets) ? p.datasets : [],
    assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
    constraints: Array.isArray(p.constraints) ? p.constraints : [],
    humanDecisions: Array.isArray(p.humanDecisions) ? p.humanDecisions : [],
    limitations: Array.isArray(p.limitations)
      ? p.limitations
      : [...fallbackLimitations],
  };
}

export function limitationsSummary(
  limitations: string[] | null | undefined,
  options?: { max?: number; fallback?: string }
): string {
  const list = Array.isArray(limitations) ? dedupeLimitations(limitations) : [];
  const slice = options?.max != null ? list.slice(0, options.max) : list;
  const joined = slice.join("; ");
  return joined || options?.fallback || "None recorded";
}

export function normalizeCandidate(
  candidate: Candidate,
  resultLimitations?: string[]
): Candidate {
  const metrics = candidateMetrics(candidate);
  const provenance = candidateProvenance(candidate, resultLimitations);
  const score =
    typeof candidate.score === "number" && Number.isFinite(candidate.score)
      ? candidate.score
      : 0;
  const rank = typeof candidate.rank === "number" && Number.isFinite(candidate.rank) ? candidate.rank : 0;
  return {
    ...candidate,
    metrics,
    provenance,
    score,
    rank,
    featureIds: Array.isArray(candidate.featureIds) ? candidate.featureIds : [],
    label: candidate.label ?? "Unnamed candidate",
    status: candidate.status ?? "eligible",
  };
}

/** Normalize analysis rows after compact persist + hydration. */
export function normalizeAnalysisResult(result: AnalysisResult): AnalysisResult {
  const limitations = analysisLimitations(result);
  const candidates = (Array.isArray(result.candidates) ? result.candidates : []).map((c) =>
    normalizeCandidate(c, limitations)
  );
  return {
    ...result,
    limitations,
    aggregateMetrics: analysisAggregateMetrics(result),
    candidates,
    summary: result.summary ?? "",
    stepLogs: Array.isArray(result.stepLogs) ? result.stepLogs : [],
  };
}

export function formatCandidateScore(candidate?: Candidate | null): string {
  if (!candidate || typeof candidate.score !== "number" || !Number.isFinite(candidate.score)) {
    return "—";
  }
  return candidate.score.toFixed(1);
}
