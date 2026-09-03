import { candidateMetricValue } from "./analysis-display";
import type { Candidate } from "./types";
import type { ResolvedShortlistEntry } from "./shortlist";

export const DEFAULT_YIELD_TOP_N = 5;

export type YieldGapSummary = {
  target: number;
  eligibleCapacity: number;
  shortfall: number;
  shortlistCapacity: number;
  topCandidateCapacity: number;
  topNCapacity: number;
  topN: number;
  topCandidateLabel?: string;
  needsWarning: boolean;
  headline: string;
  detail: string;
};

export function shortlistCombinedCapacity(shortlist: ResolvedShortlistEntry[]): number {
  return shortlist.reduce((sum, entry) => {
    const cap = entry.candidate ? candidateMetricValue(entry.candidate, "capacity") ?? 0 : 0;
    return sum + cap;
  }, 0);
}

export function eligibleCapacityFromCandidates(candidates: Candidate[]): number {
  return candidates.reduce(
    (sum, c) => sum + (candidateMetricValue(c, "capacity") ?? 0),
    0
  );
}

export function topNCandidatesCapacity(
  candidates: Candidate[],
  n: number
): { capacity: number; topCandidateCapacity: number; topCandidateLabel?: string } {
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank);
  const topN = sorted.slice(0, n);
  const topCandidateCapacity = candidateMetricValue(sorted[0], "capacity") ?? 0;
  const capacity = topN.reduce(
    (sum, c) => sum + (candidateMetricValue(c, "capacity") ?? 0),
    0
  );
  return {
    capacity,
    topCandidateCapacity,
    topCandidateLabel: sorted[0]?.label,
  };
}

function closingGapHint(): string {
  return "Closing the gap needs more parcels, higher allowed density, or dropping a constraint (transit walk, flood, or exclusions).";
}

export function computeYieldGap(input: {
  target: number;
  candidates: Candidate[];
  shortlist: ResolvedShortlistEntry[];
  topN?: number;
}): YieldGapSummary | null {
  const { target, candidates, shortlist, topN = DEFAULT_YIELD_TOP_N } = input;
  if (!target || target <= 0 || candidates.length === 0) return null;

  const eligibleCapacity = eligibleCapacityFromCandidates(candidates);
  const shortfall = Math.max(0, target - eligibleCapacity);
  const shortlistCapacity = shortlistCombinedCapacity(shortlist);
  const { capacity: topNCapacity, topCandidateCapacity, topCandidateLabel } =
    topNCandidatesCapacity(candidates, topN);

  const needsWarning = shortfall > 0 || topCandidateCapacity < target;

  const parts = [
    `Top site ~${topCandidateCapacity.toLocaleString()} homes`,
    `Top ${topN} combined ~${topNCapacity.toLocaleString()} homes`,
    shortlist.length > 0
      ? `Shortlist ${shortlist.length} site${shortlist.length === 1 ? "" : "s"} ~${shortlistCapacity.toLocaleString()} homes`
      : "No shortlist pinned",
  ];

  let headline: string;
  let extra = "";
  if (shortfall > 0) {
    headline = `Shortfall of ${shortfall.toLocaleString()} homes — ${eligibleCapacity.toLocaleString()} eligible vs ${target.toLocaleString()} target`;
    extra = ` ${closingGapHint()}`;
  } else if (topCandidateCapacity < target) {
    headline = `Eligible capacity meets ${target.toLocaleString()} homes — no single parcel does`;
    extra = ` Planners need multiple sites.`;
  } else {
    headline = `Housing target: ${target.toLocaleString()} homes`;
  }

  if (shortlist.length > 0 && shortlistCapacity < target) {
    extra += ` Shortlist capacity (${shortlistCapacity.toLocaleString()}) is below the ${target.toLocaleString()}-home target.`;
  }

  return {
    target,
    eligibleCapacity,
    shortfall,
    shortlistCapacity,
    topCandidateCapacity,
    topNCapacity,
    topN,
    topCandidateLabel,
    needsWarning,
    headline,
    detail: `${parts.join(" · ")}.${extra}`,
  };
}
