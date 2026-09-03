import { homesCountInTitle } from "@/lib/objective-display";
import {
  aggregateMetricValue,
  candidateMetricValue,
} from "./analysis-display";
import { isHousingIntent } from "./intent";
import type { AnalysisResult, PlanningIntent } from "./types";

export function resolveHousingTarget(input: {
  intent: PlanningIntent;
  objectiveTarget?: number;
  objectiveRawText?: string;
  projectName?: string;
}): number | undefined {
  if (!isHousingIntent(input.intent)) return undefined;
  if (
    input.objectiveTarget != null &&
    Number.isFinite(input.objectiveTarget) &&
    input.objectiveTarget > 0
  ) {
    return input.objectiveTarget;
  }
  if (input.projectName) {
    const fromTitle = homesCountInTitle(input.projectName);
    if (fromTitle != null) return fromTitle;
  }
  if (input.objectiveRawText) {
    const match = input.objectiveRawText.match(/(\d[\d,]*)\s*homes?\b/i);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return undefined;
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

export function topSiteCapacityFromResult(
  result?: AnalysisResult | null
): number | undefined {
  if (!result?.candidates.length) return undefined;
  const top = result.candidates.find((c) => c.rank === 1) ?? result.candidates[0];
  return candidateMetricValue(top, "capacity");
}
