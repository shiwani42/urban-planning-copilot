import type { Candidate } from "./types";

export type ScoreBand = "all" | "high" | "medium" | "low";

export type ResultsFilterState = {
  text: string;
  neighborhood: string;
  scoreBand: ScoreBand;
  shortlistedOnly: boolean;
};

export const DEFAULT_RESULTS_FILTER: ResultsFilterState = {
  text: "",
  neighborhood: "",
  scoreBand: "all",
  shortlistedOnly: false,
};

/** Neighborhood prefix from candidate labels like "Mission — Blk/Lot 3595/006". */
export function neighborhoodFromLabel(label: string): string {
  const dash = label.indexOf(" — ");
  if (dash > 0) return label.slice(0, dash).trim();
  const paren = label.indexOf(" (parcel");
  if (paren > 0) return label.slice(0, paren).trim();
  return "";
}

export function candidateNeighborhoods(candidates: Candidate[]): string[] {
  const set = new Set<string>();
  for (const c of candidates) {
    const n = neighborhoodFromLabel(c.label);
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function scoreBandFor(score: number): Exclude<ScoreBand, "all"> {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function matchesScoreBand(score: number, band: ScoreBand): boolean {
  if (band === "all") return true;
  return scoreBandFor(score) === band;
}

export function candidateMatchesText(c: Candidate, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  const haystack = [c.label, ...c.featureIds, c.id].join(" ").toLowerCase();
  return haystack.includes(q);
}

export function filterCandidates(
  candidates: Candidate[],
  filter: ResultsFilterState,
  shortlistedIds: Set<string>
): Candidate[] {
  return candidates.filter((c) => {
    if (filter.shortlistedOnly && !shortlistedIds.has(c.id)) return false;
    if (filter.neighborhood && neighborhoodFromLabel(c.label) !== filter.neighborhood) {
      return false;
    }
    if (!matchesScoreBand(c.score, filter.scoreBand)) return false;
    if (!candidateMatchesText(c, filter.text)) return false;
    return true;
  });
}
