import type { WorkspaceSnapshot } from "@/lib/domain/types";
import { paginateCandidatesCompact } from "@/lib/domain/analysis-candidates";

let snapshot: WorkspaceSnapshot | null = null;

export function setBrowserWorkspaceSnapshot(next: WorkspaceSnapshot | null): void {
  snapshot = next;
}

export function getBrowserWorkspaceSnapshot(): WorkspaceSnapshot | null {
  return snapshot;
}

/** Instant list_candidates from the open study — no server round-trip. */
export function listCandidatesFromBrowserCache(input: {
  projectId?: string;
  scenarioId?: string;
  limit?: number;
  offset?: number;
}): ReturnType<typeof paginateCandidatesCompact> & { status: "ok" | "error"; error?: string } | null {
  const ws = snapshot;
  if (!ws) return null;
  if (input.projectId && input.projectId !== ws.project.id) return null;
  const scenarioId = input.scenarioId ?? ws.project.activeScenarioId;
  const scenario =
    ws.scenarios.find((s) => s.id === scenarioId) ?? ws.scenarios[0];
  if (!scenario) return null;
  const result = ws.analysisResults.find((r) => r.id === scenario.latestResultId);
  const failedJob = [...ws.analysisJobs]
    .reverse()
    .find((j) => j.scenarioId === scenario.id && j.status === "failed");
  if (failedJob && (!result || result.stale)) {
    const empty = result
      ? paginateCandidatesCompact(result, input.limit, input.offset)
      : {
          totalCount: 0,
          offset: 0,
          limit: Math.max(1, Math.min(100, Number(input.limit ?? 10) || 10)),
          scoreSpread: 0,
          stale: true,
          summary: "",
          candidates: [],
        };
    return {
      ...empty,
      status: "error",
      error: failedJob.error ?? "Analysis failed",
      candidates: [],
    };
  }
  if (!result) return null;
  return { status: "ok", ...paginateCandidatesCompact(result, input.limit, input.offset) };
}
