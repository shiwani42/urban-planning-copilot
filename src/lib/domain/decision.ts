import type { AnalysisResult, Scenario } from "./types";

/** Minimum characters for approve/reject/request-changes reasons. */
export const MIN_DECISION_REASON_LENGTH = 10;

const JUNK_REASONS = new Set(["ok", "yes", "no", "n/a", "na", "test", "asdf", "xxx", "done"]);

export function normalizeDecisionReason(reason: string | undefined): string {
  return (reason ?? "").trim();
}

export function isJunkDecisionReason(reason: string): boolean {
  const trimmed = normalizeDecisionReason(reason);
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (JUNK_REASONS.has(lower)) return true;
  const tokens = lower.split(/\s+/);
  if (tokens.every((t) => JUNK_REASONS.has(t) || t.length <= 3)) {
    return true;
  }
  if (/^(.)\1{2,}$/.test(lower)) return true;
  if (/^[\W\d_]+$/.test(lower)) return true;
  return false;
}

export function validateDecisionReason(reason: string | undefined): string | null {
  const trimmed = normalizeDecisionReason(reason);
  if (!trimmed) {
    return "Please enter a reason — required for the audit trail.";
  }
  if (trimmed.length < MIN_DECISION_REASON_LENGTH) {
    return `Reason must be at least ${MIN_DECISION_REASON_LENGTH} characters.`;
  }
  if (isJunkDecisionReason(trimmed)) {
    return "Please provide a substantive justification (not placeholders like \"ok\").";
  }
  return null;
}

export function getLatestCompletedResult(
  scenario: Scenario,
  results: AnalysisResult[]
): AnalysisResult | undefined {
  if (!scenario.latestResultId) return undefined;
  return results.find((r) => r.id === scenario.latestResultId);
}

export function getLatestFreshResult(
  scenario: Scenario,
  results: AnalysisResult[]
): AnalysisResult | undefined {
  const result = getLatestCompletedResult(scenario, results);
  if (!result || result.status !== "completed" || result.stale) return undefined;
  return result;
}

export function requireAnalysisForDecision(
  scenario: Scenario,
  results: AnalysisResult[]
): string | null {
  const result = getLatestCompletedResult(scenario, results);
  if (!result) {
    return "Run analysis on this scenario before recording a decision.";
  }
  if (result.stale || result.status === "stale") {
    return "Results are stale — recalculate analysis before deciding.";
  }
  if (result.status !== "completed") {
    return "Run analysis on this scenario before recording a decision.";
  }
  if (result.candidates.length === 0) {
    return "No feasible candidates to decide on — adjust constraints or run a new analysis.";
  }
  return null;
}

export function isScenarioDecisionStale(
  scenario: Scenario,
  currentConfigHash: string,
  currentResultId?: string
): boolean {
  if (scenario.decisionStatus !== "approved") return false;
  if (scenario.decisionStale) return true;
  if (
    scenario.approvedAgainstConfigHash &&
    scenario.approvedAgainstConfigHash !== currentConfigHash
  ) {
    return true;
  }
  if (
    scenario.approvedAgainstResultId &&
    currentResultId &&
    scenario.approvedAgainstResultId !== currentResultId
  ) {
    return true;
  }
  return false;
}

export function topRankedCandidate(result: AnalysisResult | undefined) {
  if (!result?.candidates.length) return undefined;
  return (
    result.candidates.find((c) => c.rank === 1) ??
    [...result.candidates].sort((a, b) => a.rank - b.rank)[0]
  );
}

export function canRecordScenarioDecision(
  scenario: Scenario,
  results: AnalysisResult[],
  type: "approve_scenario" | "reject_scenario" | "request_changes",
  reason?: string
): string | null {
  const analysisError = requireAnalysisForDecision(scenario, results);
  if (analysisError) return analysisError;

  if (type === "approve_scenario" && scenario.decisionStatus === "changes_requested") {
    return "Changes were requested — review updates and run a fresh analysis before approving.";
  }

  if (type === "approve_scenario" || type === "reject_scenario") {
    const reasonError = validateDecisionReason(reason);
    if (reasonError) return reasonError;
  }

  if (type === "request_changes") {
    const trimmed = normalizeDecisionReason(reason);
    if (trimmed && trimmed.length < MIN_DECISION_REASON_LENGTH) {
      return `Please describe what changes are needed (at least ${MIN_DECISION_REASON_LENGTH} characters).`;
    }
  }

  return null;
}
