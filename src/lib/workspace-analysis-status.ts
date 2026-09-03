/** Single empty-analysis sentence for workspace chrome — do not duplicate elsewhere. */
export const EMPTY_ANALYSIS_STATUS =
  "No analysis yet — run analysis for this scenario.";

export function workspaceHasComparableResults(result?: {
  status?: string;
  stale?: boolean;
} | null): boolean {
  return Boolean(result && result.status === "completed" && !result.stale);
}
