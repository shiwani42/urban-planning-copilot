import { formatRelativeTime, projectRecencyIso } from "@/lib/format";
import type { RecentAnalysisRow } from "@/lib/domain/types";

type ContinueProject = {
  resumeNote?: string;
  activeScenarioNote?: string;
  activeScenarioStatus?: string;
  actionRequiredKind?: "manual" | "data" | "ai";
  updatedAt: string;
  lastOpenedAt?: string;
};

export function inferContinueActivityKind(
  note: string
): "ai" | "data" | "manual" {
  const lower = note.toLowerCase();
  if (
    lower.includes("agent") ||
    lower.includes("copilot") ||
    lower.includes("candidate") ||
    lower.includes("recalculated") ||
    lower.includes("review results")
  ) {
    return "ai";
  }
  if (
    lower.includes("data") ||
    lower.includes("flood") ||
    lower.includes("dataset") ||
    lower.includes("recalculate") ||
    lower.includes("stale") ||
    lower.includes("missing")
  ) {
    return "data";
  }
  return "manual";
}

export function continueCardActivity(project: ContinueProject): {
  text: string;
  kind: "ai" | "data" | "manual";
  when: string;
} {
  const text =
    project.activeScenarioNote?.trim() ||
    project.resumeNote?.trim() ||
    project.activeScenarioStatus?.trim() ||
    "Open to continue planning work.";
  const kind =
    project.actionRequiredKind ?? inferContinueActivityKind(text);
  return {
    text,
    kind,
    when: formatRelativeTime(projectRecencyIso(project)),
  };
}

export function scenarioChipLabel(name?: string): string {
  if (!name) return "BASELINE";
  return name.length <= 14 ? name.toUpperCase() : `${name.slice(0, 12).toUpperCase()}…`;
}

export function analysisStatusPresentation(
  status: RecentAnalysisRow["status"]
): { label: string; className: string; dotClassName: string } {
  switch (status) {
    case "running":
      return {
        label: "Running",
        className:
          "border border-outline-variant/60 bg-surface-container text-on-surface-variant",
        dotClassName: "w-3 h-3 border-2 border-outline-variant border-t-outline rounded-full animate-spin",
      };
    case "failed":
      return {
        label: "Failed",
        className: "border border-error/30 bg-error-container/20 text-error",
        dotClassName: "w-1.5 h-1.5 rounded-full bg-error",
      };
    case "stale":
      return {
        label: "Stale",
        className: "border border-secondary/30 bg-secondary-fixed/15 text-secondary",
        dotClassName: "w-1.5 h-1.5 rounded-full bg-secondary",
      };
    default:
      return {
        label: "Complete",
        className: "border border-primary/25 bg-primary-fixed/15 text-primary",
        dotClassName: "w-1.5 h-1.5 rounded-full bg-primary-container",
      };
  }
}
