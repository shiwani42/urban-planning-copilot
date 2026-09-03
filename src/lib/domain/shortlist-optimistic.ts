import type { Scenario, ShortlistEntry, WorkspaceSnapshot } from "./types";
import { findCandidateInResult, findShortlistEntry, shortlistEntries } from "./shortlist";

export type ShortlistMutation = {
  action: "pin" | "unpin";
  candidateId: string;
  reason?: string;
  note?: string;
};

function activeScenario(workspace: WorkspaceSnapshot): Scenario | undefined {
  return (
    workspace.scenarios.find((s) => s.id === workspace.project.activeScenarioId) ??
    workspace.scenarios[0]
  );
}

/** Apply a pin/unpin to in-memory workspace so the map and table update before persist returns. */
export function applyShortlistMutation(
  workspace: WorkspaceSnapshot,
  mutation: ShortlistMutation
): WorkspaceSnapshot {
  const scenario = activeScenario(workspace);
  if (!scenario) return workspace;
  const result = workspace.analysisResults.find((r) => r.id === scenario.latestResultId);
  const candidate = findCandidateInResult(result, mutation.candidateId);
  const candidateId = candidate?.id ?? mutation.candidateId;
  const featureIds = candidate?.featureIds ?? [mutation.candidateId];
  const label = candidate?.label ?? mutation.candidateId;
  const existing = shortlistEntries(scenario);

  let nextShortlist: ShortlistEntry[];
  if (mutation.action === "unpin") {
    nextShortlist = existing.filter(
      (e) => e.candidateId !== candidateId && !e.featureIds.includes(candidateId)
    );
  } else {
    const found = findShortlistEntry(existing, candidateId, featureIds);
    if (found) {
      nextShortlist = existing.map((e) =>
        e === found
          ? {
              ...e,
              candidateId,
              label,
              featureIds: [...featureIds],
              reason: mutation.reason?.trim() || e.reason,
              note: mutation.note !== undefined ? mutation.note.trim() || undefined : e.note,
            }
          : e
      );
    } else {
      nextShortlist = [
        ...existing,
        {
          featureIds: [...featureIds],
          candidateId,
          label,
          pinnedAt: new Date().toISOString(),
          reason: mutation.reason?.trim() || undefined,
          note: mutation.note?.trim() || undefined,
        },
      ];
    }
  }

  return {
    ...workspace,
    scenarios: workspace.scenarios.map((s) =>
      s.id === scenario.id ? { ...s, shortlist: nextShortlist } : s
    ),
  };
}
