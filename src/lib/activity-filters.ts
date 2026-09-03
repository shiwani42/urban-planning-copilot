import type { ActivityEvent } from "@/lib/domain/types";

/** Activity tab filter chips — Stitch activity_provenance_timeline_workspace_audit. */
export type ActivityFilter =
  | "all"
  | "agent"
  | "human"
  | "analysis"
  | "data"
  | "decisions";

export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "All",
  agent: "Agent",
  human: "Human",
  analysis: "Analysis",
  data: "Data",
  decisions: "Decisions",
};

export function matchesActivityFilter(
  event: Pick<ActivityEvent, "actor" | "category">,
  filter: ActivityFilter
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "agent":
      return event.actor === "agent" || event.category === "agent";
    case "human":
      return event.actor === "human";
    case "analysis":
      return event.category === "analysis";
    case "data":
      return event.category === "data";
    case "decisions":
      return event.category === "decision";
    default:
      return true;
  }
}

export function activityCategoryLabel(category: ActivityEvent["category"]): string {
  switch (category) {
    case "objective":
      return "Objective";
    case "constraint":
      return "Constraint";
    case "analysis":
      return "Analysis";
    case "map":
      return "Map";
    case "scenario":
      return "Scenario";
    case "decision":
      return "Decision";
    case "data":
      return "Data";
    case "report":
      return "Report";
    case "agent":
      return "Agent";
    default: {
      const fallback = category as string;
      return fallback.replace(/_/g, " ");
    }
  }
}

export function activityActorAccent(actor: ActivityEvent["actor"]): {
  bar: string;
  badge: string;
  icon: string;
} {
  if (actor === "human") {
    return {
      bar: "bg-secondary",
      badge: "text-secondary",
      icon: "person",
    };
  }
  if (actor === "agent") {
    return {
      bar: "bg-primary-container",
      badge: "text-primary-container",
      icon: "smart_toy",
    };
  }
  return {
    bar: "bg-outline",
    badge: "text-on-surface-variant",
    icon: "settings",
  };
}
