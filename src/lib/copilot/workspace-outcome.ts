import type { AnalysisJob, AnalysisResult, WorkspaceSnapshot } from "@/lib/domain/types";
import type { CopilotActivityEntry } from "@/lib/copilot/copilot-activity";

export type WorkspaceOutcomeContext = {
  runningJob?: AnalysisJob | null;
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
    return latestCopilot.summary || "The last copilot action failed — see Agent activity for details.";
  }
  if (latestCopilot?.status === "success" && latestCopilot.summary) {
    return latestCopilot.summary;
  }

  if (ctx.runningJob) {
    return ctx.runningJob.currentStep ?? "Analysis is running for this scenario…";
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

  return "No analysis results yet — review the plan and run analysis, or ask the copilot to run it for you.";
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
  const isFreshResult = Boolean(
    result && result.status === "completed" && !result.stale && scenario?.latestResultId === result.id
  );
  return describeWorkspaceOutcome({
    runningJob,
    result,
    isFreshResult,
    copilotActivity,
    scenarioName: scenario?.name,
  });
}
