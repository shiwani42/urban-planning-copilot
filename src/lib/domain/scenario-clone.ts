import type { Scenario } from "./types";

/** Copy a scenario for branching without structuredClone edge cases. */
export function cloneScenarioForBranch(
  source: Scenario,
  id: string,
  name: string,
  at: string
): Scenario {
  return {
    id,
    projectId: source.projectId,
    name,
    description: source.description,
    status: "draft",
    parentScenarioId: source.id,
    objective: structuredClone(source.objective),
    constraints: structuredClone(source.constraints),
    weights: structuredClone(source.weights),
    assumptions: structuredClone(source.assumptions),
    geographicSelections: structuredClone(source.geographicSelections),
    enabledDatasetIds: [...source.enabledDatasetIds],
    analysisPlan: source.analysisPlan ? structuredClone(source.analysisPlan) : undefined,
    latestResultId: undefined,
    decisionStatus: "none",
    decisionStale: undefined,
    decisionStaleReason: undefined,
    approvedAgainstConfigHash: undefined,
    approvedAgainstResultId: undefined,
    preferredCandidateId: undefined,
    shortlist: source.shortlist ? structuredClone(source.shortlist) : [],
    createdAt: at,
    updatedAt: at,
    savedAt: undefined,
    annotations: [],
  };
}
