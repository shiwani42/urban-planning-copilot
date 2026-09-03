import type { AnalysisResult, AppStore, Scenario } from "./types";

export function scenarioAnalysisResult(
  scenario: Scenario,
  results: AnalysisResult[]
): AnalysisResult | undefined {
  if (!scenario.latestResultId) return undefined;
  return results.find((result) => result.id === scenario.latestResultId);
}

/** True when a scenario has fresh completed analysis with ranked candidates. */
export function scenarioHasComparableAnalysis(
  scenario: Scenario,
  results: AnalysisResult[]
): boolean {
  const result = scenarioAnalysisResult(scenario, results);
  return Boolean(
    result &&
      result.status === "completed" &&
      !result.stale &&
      result.candidates.length > 0
  );
}

export function countComparableScenarios(
  scenarios: Scenario[],
  results: AnalysisResult[]
): number {
  return scenarios.filter((scenario) => scenarioHasComparableAnalysis(scenario, results)).length;
}

export function firstUnanalyzedScenarioName(
  scenarios: Scenario[],
  results: AnalysisResult[]
): string | undefined {
  return scenarios.find((scenario) => !scenarioHasComparableAnalysis(scenario, results))?.name;
}

export function scenariosForProject(store: AppStore, projectId: string): Scenario[] {
  return store.scenarios.filter((s) => s.projectId === projectId);
}

/** Prefer Baseline, otherwise the oldest scenario for the project. */
export function pickDefaultScenarioId(scenarios: Scenario[]): string | undefined {
  if (scenarios.length === 0) return undefined;
  const baseline = scenarios.find((s) => s.name.trim().toLowerCase() === "baseline");
  return baseline?.id ?? scenarios[0]?.id;
}

/**
 * Resolve a scenario id for mutations: honor a valid request id, else active scenario,
 * else Baseline / first remaining scenario.
 */
export function resolveScenarioId(
  store: AppStore,
  projectId: string,
  requestedId?: string | null
): string | undefined {
  const scenarios = scenariosForProject(store, projectId);
  if (scenarios.length === 0) return undefined;

  if (requestedId && scenarios.some((s) => s.id === requestedId)) {
    return requestedId;
  }

  const project = store.projects.find((p) => p.id === projectId);
  if (
    project?.activeScenarioId &&
    scenarios.some((s) => s.id === project.activeScenarioId)
  ) {
    return project.activeScenarioId;
  }

  return pickDefaultScenarioId(scenarios);
}

export function activeScenarioNeedsRepair(
  store: AppStore,
  projectId: string
): string | undefined {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return undefined;
  const scenarios = scenariosForProject(store, projectId);
  if (scenarios.length === 0) return undefined;
  if (
    project.activeScenarioId &&
    scenarios.some((s) => s.id === project.activeScenarioId)
  ) {
    return undefined;
  }
  return pickDefaultScenarioId(scenarios);
}
