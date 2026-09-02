import { candidateMetricValue } from "./analysis-display";
import type { Candidate } from "./types";
import type { ResolvedShortlistEntry } from "./shortlist";

export const DEFAULT_YIELD_TOP_N = 5;

export type YieldGapSummary = {
  target: number;
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

export function computeYieldGap(input: {
  target: number;
  candidates: Candidate[];
  shortlist: ResolvedShortlistEntry[];
  topN?: number;
}): YieldGapSummary | null {
  const { target, candidates, shortlist, topN = DEFAULT_YIELD_TOP_N } = input;
  if (!target || target <= 0 || candidates.length === 0) return null;

  const shortlistCapacity = shortlistCombinedCapacity(shortlist);
  const { capacity: topNCapacity, topCandidateCapacity, topCandidateLabel } =
    topNCandidatesCapacity(candidates, topN);

  const needsWarning =
    topCandidateCapacity < target || (shortlist.length > 0 && shortlistCapacity < target);

  const headline = `Housing target: ${target.toLocaleString()} homes`;
  const parts = [
    `Top site ~${topCandidateCapacity.toLocaleString()} homes`,
    `Top ${topN} combined ~${topNCapacity.toLocaleString()} homes`,
    shortlist.length > 0
      ? `Shortlist ${shortlist.length} site${shortlist.length === 1 ? "" : "s"} ~${shortlistCapacity.toLocaleString()} homes`
      : "No shortlist pinned",
  ];

  let warningNote = "";
  if (topCandidateCapacity < target) {
    warningNote = ` No single parcel meets the ${target.toLocaleString()}-home objective — planners need multiple sites.`;
  } else if (shortlist.length > 0 && shortlistCapacity < target) {
    warningNote = ` Shortlist capacity (${shortlistCapacity.toLocaleString()}) is below the ${target.toLocaleString()}-home target.`;
  }

  return {
    target,
    shortlistCapacity,
    topCandidateCapacity,
    topNCapacity,
    topN,
    topCandidateLabel,
    needsWarning,
    headline,
    detail: `${parts.join(" · ")}.${warningNote}`,
  };
}
