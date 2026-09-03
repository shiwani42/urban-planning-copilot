import type { AnalysisResult, Report } from "@/lib/domain/types";

/** True when analysis completed after the report snapshot (or report is explicitly stale). */
export function isReportBehindAnalysis(
  report: Report,
  result: AnalysisResult | undefined
): boolean {
  if (report.stale) return true;
  if (!result || result.stale || result.status !== "completed") return false;
  const reportAt = Date.parse(report.createdAt);
  const analysisAt = Date.parse(result.completedAt ?? result.createdAt);
  if (Number.isNaN(reportAt) || Number.isNaN(analysisAt)) return false;
  return analysisAt > reportAt;
}

export function reportStaleLabel(
  report: Report,
  result: AnalysisResult | undefined
): string | null {
  if (report.stale && report.staleReason) return report.staleReason;
  if (isReportBehindAnalysis(report, result)) {
    return "Analysis is newer than this report — regenerate to include latest results.";
  }
  return null;
}
