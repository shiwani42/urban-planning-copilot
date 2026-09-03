import { homesCountInTitle } from "@/lib/objective-display";
import {
  aggregateMetricValue,
  candidateMetricValue,
} from "./analysis-display";
import { isHousingIntent } from "./intent";
import type { AnalysisResult, PlanningIntent } from "./types";

function homesCountInText(text?: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(\d[\d,]*)\s*homes?\b/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function resolveHousingTarget(input: {
  intent: PlanningIntent;
  objectiveTarget?: number;
  objectiveRawText?: string;
  projectName?: string;
}): number | undefined {
  if (!isHousingIntent(input.intent)) return undefined;
  const fromField =
    input.objectiveTarget != null &&
    Number.isFinite(input.objectiveTarget) &&
    input.objectiveTarget > 0
      ? input.objectiveTarget
      : undefined;
  const fromRaw = homesCountInText(input.objectiveRawText);
  const fromTitle = input.projectName ? homesCountInTitle(input.projectName) : undefined;
  // Typed objective text is the current brief when it disagrees with a leftover parsed field (e.g. 50 vs 2,000).
  if (fromRaw != null && fromField != null && fromRaw !== fromField) return fromRaw;
  if (fromField != null) return fromField;
  if (fromTitle != null) return fromTitle;
  return fromRaw;
}

/** Total estimated homes from aggregate metrics or candidate capacities. */
export function totalCapacityFromResult(
  result?: AnalysisResult | null
): number | undefined {
  const fromAggregate = aggregateMetricValue(result, "total_capacity");
  if (fromAggregate != null) return fromAggregate;
  if (!result?.candidates.length) return undefined;
  const sum = result.candidates.reduce(
    (total, candidate) => total + (candidateMetricValue(candidate, "capacity") ?? 0),
    0
  );
  return sum > 0 ? sum : undefined;
}

export function analyzedHousingTarget(
  result?: AnalysisResult | null
): number | undefined {
  const gap = result?.aggregateMetrics?.find((m) => m.key === "housing_target_gap");
  const fromInputs = gap?.inputs?.target_homes;
  if (typeof fromInputs === "number" && Number.isFinite(fromInputs) && fromInputs > 0) {
    return fromInputs;
  }
  return undefined;
}

/** True when the last ranking was run against a different housing target than the current brief. */
export function rankingStaleVersusObjective(
  result: AnalysisResult | null | undefined,
  currentTarget: number | undefined
): boolean {
  if (!result || currentTarget == null || currentTarget <= 0) return false;
  const analyzed = analyzedHousingTarget(result);
  if (analyzed == null) return false;
  return analyzed !== currentTarget;
}

export function rankingStaleMessage(currentTarget: number, analyzedTarget: number): string {
  return `Ranking is from a ${analyzedTarget.toLocaleString()}-home brief — recalculate to match the ${currentTarget.toLocaleString()}-home objective.`;
}

export function topSiteCapacityFromResult(
  result?: AnalysisResult | null
): number | undefined {
  if (!result?.candidates.length) return undefined;
  const top = result.candidates.find((c) => c.rank === 1) ?? result.candidates[0];
  return candidateMetricValue(top, "capacity");
}
