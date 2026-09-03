import type { AnalysisJob, AppStore } from "./types";

/** Running jobs older than this are treated as interrupted (e.g. deploy mid-analysis). */
export const STALE_RUNNING_ANALYSIS_MS = 5 * 60 * 1000;

export function isStaleRunningAnalysisJob(job: AnalysisJob, nowMs = Date.now()): boolean {
  if (job.status !== "running") return false;
  const started = Date.parse(job.startedAt);
  if (!Number.isFinite(started)) return true;
  return nowMs - started > STALE_RUNNING_ANALYSIS_MS;
}

export function staleRunningJobMessage(): string {
  return "Analysis interrupted — stale running job cleared. Retry run_analysis.";
}

export function interruptedAnalysisJobMessage(): string {
  return "Analysis interrupted (service restarted) — retry run_analysis.";
}

/** Mark in-flight jobs failed after process restart — avoids silent stale forever. */
export function reconcileInterruptedAnalysisJobsOnBoot(store: AppStore): boolean {
  let changed = false;
  const message = interruptedAnalysisJobMessage();
  for (const job of store.analysisJobs) {
    if (job.status !== "running") continue;
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.error = message;
    job.currentStep = "Interrupted";
    changed = true;
  }
  return changed;
}
