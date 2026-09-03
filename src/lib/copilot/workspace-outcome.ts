import type { AnalysisJob, AnalysisResult, WorkspaceSnapshot } from "@/lib/domain/types";
import type { CopilotActivityEntry } from "@/lib/copilot/copilot-activity";
import { COPILOT_ACTION_FAILED, FINDINGS_EMPTY_OUTCOME } from "@/lib/planner-copy";

export type WorkspaceOutcomeContext = {
  runningJob?: AnalysisJob | null;
  failedJob?: AnalysisJob | null;
  result?: AnalysisResult | null;
  isFreshResult?: boolean;
  copilotActivity?: CopilotActivityEntry[];
  scenarioName?: string;
};

/**
 * One human-readable sentence for the workspace inspector — latest analysis or copilot outcome.
 */
export function describeWorkspaceOutcome(ctx: WorkspaceOutcomeContext): string {
  const latestCopilot = (ctx.copilotActivity ?? []).find(
    (entry) => entry.tool !== "navigate" && entry.tool !== "planner"
  );
  if (latestCopilot?.status === "running") {
    return latestCopilot.summary || "Copilot is running a planning tool for this scenario…";
  }
  if (latestCopilot?.status === "error") {
    return latestCopilot.summary || COPILOT_ACTION_FAILED;
  }
  if (latestCopilot?.status === "success" && latestCopilot.summary) {
    return latestCopilot.summary;
  }

  if (ctx.runningJob) {
    return ctx.runningJob.currentStep ?? "Analysis is running for this scenario…";
  }

  if (ctx.failedJob) {
    return ctx.failedJob.error ?? "Analysis failed — retry run_analysis after reviewing constraints.";
  }

  const result = ctx.result;
  if (result?.status === "failed") {
    return result.summary || "Analysis failed — adjust constraints or rerun from the workspace.";
  }

  if (result && ctx.isFreshResult) {
    const count = result.candidates.length;
    const top = result.candidates.find((c) => c.rank === 1) ?? result.candidates[0];
    const scenario = ctx.scenarioName ? ` for ${ctx.scenarioName}` : "";
    if (top && count > 0) {
      return `Analysis complete${scenario} — ${count} candidates ranked; top site is ${top.label} (score ${top.score.toFixed(1)}).`;
    }
    return `Analysis complete${scenario} — ${count} candidate${count === 1 ? "" : "s"} ranked.`;
  }

  if (result && (result.stale || result.status === "stale")) {
    return `Results are stale (${result.candidates.length} candidates from the last run) — recalculate to apply your latest changes.`;
  }

  return FINDINGS_EMPTY_OUTCOME;
}

export function outcomeFromWorkspace(
  workspace: WorkspaceSnapshot,
  scenarioId: string | undefined,
  copilotActivity: CopilotActivityEntry[] = []
): string {
  const scenario = workspace.scenarios.find((s) => s.id === scenarioId) ?? workspace.scenarios[0];
  const result = workspace.analysisResults.find((r) => r.id === scenario?.latestResultId);
  const runningJob = workspace.analysisJobs.find(
    (j) => j.scenarioId === scenario?.id && j.status === "running"
  );
  const failedJob = [...workspace.analysisJobs]
    .reverse()
    .find((j) => j.scenarioId === scenario?.id && j.status === "failed");
  const isFreshResult = Boolean(
    result && result.status === "completed" && !result.stale && scenario?.latestResultId === result.id
  );
  return describeWorkspaceOutcome({
    runningJob,
    failedJob:
      failedJob &&
      (!result?.completedAt || (failedJob.completedAt ?? "") >= result.completedAt)
        ? failedJob
        : null,
    result,
    isFreshResult,
    copilotActivity,
    scenarioName: scenario?.name,
  });
}
