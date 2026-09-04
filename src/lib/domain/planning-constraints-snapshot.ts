import { analysisLimitations } from "./analysis-display";
import { resolveHousingTarget } from "./housing-target";
import { isHousingIntent } from "./intent";
import { getShortlistForScenario } from "./services";
import type { Constraint, DatasetMeta, Scenario, WorkspaceSnapshot } from "./types";
import { computeYieldGap } from "./yield-gap";

function transitThresholdMeters(constraints: Constraint[]): number | undefined {
  const transit = constraints.find(
    (c) => c.enabled && c.datasetKind === "transit" && c.operator === "within_distance"
  );
  return typeof transit?.value === "number" ? transit.value : undefined;
}

function floodConstraintSummary(constraints: Constraint[]) {
  const flood = constraints.find(
    (c) => c.enabled && c.datasetKind === "flood" && c.operator === "not_intersects"
  );
  if (!flood) return null;
  return {
    enabled: true,
    label: flood.label,
    operator: flood.operator,
    hard: flood.hard,
  };
}

function datasetLimitationsForScenario(
  datasets: DatasetMeta[],
  enabledDatasetIds: string[]
): Array<{ id: string; name: string; kind: string; limitations: string[]; stale: boolean }> {
  const enabled = new Set(enabledDatasetIds);
  return datasets
    .filter((d) => d.enabled && (enabled.size === 0 || enabled.has(d.id)))
    .map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      limitations: d.limitations,
      stale: Boolean(d.stale),
    }));
}

export function buildPlanningConstraintsSnapshot(
  ws: WorkspaceSnapshot,
  scenarioId?: string
) {
  const scenario =
    ws.scenarios.find((s) => s.id === scenarioId) ??
    ws.scenarios.find((s) => s.id === ws.project.activeScenarioId) ??
    ws.scenarios[0];
  if (!scenario) {
    return null;
  }

  const result = ws.analysisResults.find((r) => r.id === scenario.latestResultId);
  const enabledConstraints = scenario.constraints
    .filter((c) => c.enabled)
    .map((c) => ({
      id: c.id,
      label: c.label,
      datasetKind: c.datasetKind,
      operator: c.operator,
      value: c.value,
      hard: c.hard,
    }));

  const housingTarget = resolveHousingTarget({
    intent: scenario.objective.intent,
    objectiveTarget: scenario.objective.targetValue,
    objectiveRawText: scenario.objective.rawText,
    projectName: ws.project.name,
  });

  const shortlist = getShortlistForScenario(scenario, result);
  const yieldGap =
    housingTarget && result?.candidates.length && isHousingIntent(scenario.objective.intent)
      ? computeYieldGap({
          target: housingTarget,
          candidates: result.candidates,
          shortlist,
        })
      : null;

  const hasResults = Boolean(
    result &&
      (Array.isArray(result.candidates)
        ? result.candidates.length > 0
        : Boolean(scenario.latestResultId))
  );

  return {
    projectId: ws.project.id,
    projectName: ws.project.name,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    objective: {
      intent: scenario.objective.intent,
      rawText: scenario.objective.rawText,
      targetValue: scenario.objective.targetValue,
      parsedRequirements: scenario.objective.parsedRequirements ?? [],
    },
    enabledConstraints,
    transitThresholdMeters: transitThresholdMeters(scenario.constraints),
    floodConstraint: floodConstraintSummary(scenario.constraints),
    weights: scenario.weights.map((w) => ({
      key: w.key,
      label: w.label,
      weight: w.weight,
    })),
    assumptions: scenario.assumptions.map((a) => ({
      key: a.key,
      label: a.label,
      value: a.value,
      unit: a.unit,
    })),
    datasetLimitations: datasetLimitationsForScenario(
      ws.datasets,
      scenario.enabledDatasetIds
    ),
    analysisLimitations: analysisLimitations(result),
    stale: result?.stale ?? false,
    staleReason: result?.staleReason,
    decisionStatus: scenario.decisionStatus,
    decisionStale: scenario.decisionStale ?? false,
    hasResults,
    housingTarget: housingTarget ?? null,
    eligibleCapacity: yieldGap?.eligibleCapacity ?? null,
    shortfall: yieldGap?.shortfall ?? null,
    yieldGap: yieldGap
      ? {
          headline: yieldGap.headline,
          detail: yieldGap.detail,
          topCandidateCapacity: yieldGap.topCandidateCapacity,
          shortlistCapacity: yieldGap.shortlistCapacity,
        }
      : null,
  };
}
