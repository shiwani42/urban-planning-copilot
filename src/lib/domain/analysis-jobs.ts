import type { AnalysisJob } from "./types";

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
