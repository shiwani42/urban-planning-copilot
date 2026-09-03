import { candidateMetricValue } from "./analysis-display";
import type { Candidate } from "./types";

export type ScoreBand = "all" | "high" | "medium" | "low";
export type FloodRiskBand = "all" | "high" | "moderate" | "low";

export type ResultsFilterState = {
  text: string;
  neighborhood: string;
  scoreBand: ScoreBand;
  floodRisk: FloodRiskBand;
  capacityMin: string;
  capacityMax: string;
  shortlistedOnly: boolean;
};

export const DEFAULT_RESULTS_FILTER: ResultsFilterState = {
  text: "",
  neighborhood: "",
  scoreBand: "all",
  floodRisk: "all",
  capacityMin: "",
  capacityMax: "",
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

export function candidateCapacityHomes(candidate: Candidate): number | null {
  const value = candidateMetricValue(candidate, "capacity");
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function floodRiskBandForCandidate(
  candidate: Candidate
): Exclude<FloodRiskBand, "all"> {
  const resilience = candidateMetricValue(candidate, "flood_resilience");
  if (resilience != null) {
    if (resilience < 40) return "high";
    if (resilience < 70) return "moderate";
    return "low";
  }
  const exposure = candidateMetricValue(candidate, "flood_exposure");
  if (exposure != null) {
    if (exposure >= 80) return "high";
    if (exposure >= 50) return "moderate";
    return "low";
  }
  return "low";
}

export function matchesFloodRiskBand(candidate: Candidate, band: FloodRiskBand): boolean {
  if (band === "all") return true;
  return floodRiskBandForCandidate(candidate) === band;
}

export function matchesCapacityRange(
  candidate: Candidate,
  minText: string,
  maxText: string
): boolean {
  const capacity = candidateCapacityHomes(candidate);
  if (capacity == null) return false;
  const min = minText.trim() ? Number(minText.replace(/,/g, "")) : undefined;
  const max = maxText.trim() ? Number(maxText.replace(/,/g, "")) : undefined;
  if (min != null && Number.isFinite(min) && capacity < min) return false;
  if (max != null && Number.isFinite(max) && capacity > max) return false;
  return true;
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
    if (!matchesFloodRiskBand(c, filter.floodRisk)) return false;
    if (
      (filter.capacityMin.trim() || filter.capacityMax.trim()) &&
      !matchesCapacityRange(c, filter.capacityMin, filter.capacityMax)
    ) {
      return false;
    }
    if (!candidateMatchesText(c, filter.text)) return false;
    return true;
  });
}
