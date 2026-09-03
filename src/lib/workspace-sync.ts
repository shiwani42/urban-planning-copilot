import type {
  CompareTableRow,
  HousingTargetProgress,
  ScenarioInputsDiff,
} from "@/lib/domain/compare";
import type { WorkspaceTab } from "@/lib/workspace-tabs";

/** Browser event bus so WebMCP tool mutations refresh open workspace UI without reload. */
export const WORKSPACE_MUTATED_EVENT = "upc:workspace-mutated";

export type CompareScenariosToolPayload = {
  status?: "ready" | "incomplete" | string;
  message?: string;
  comparison?: Array<Record<string, string | number>> | null;
  tableRows?: CompareTableRow[] | null;
  inputsDiff?: ScenarioInputsDiff | null;
  housingTargets?: Array<{
    scenarioId: string;
    name: string;
    progress: HousingTargetProgress | null;
  }> | null;
  metricsIdentical?: boolean;
  insights?: Array<{ heading: string; body: string }> | null;
};

export type WorkspaceMutatedDetail = {
  projectId?: string;
  tool?: string;
  resumeNote?: string;
  criteriaStale?: boolean;
  mapViewport?: { center: [number, number]; zoom: number };
  /** Open a workspace tab after a read-only planner tool (e.g. compare). */
  openTab?: WorkspaceTab;
  compareScenarioIds?: string[];
  comparePayload?: CompareScenariosToolPayload;
  /** Active scenario after branch creation — keeps copilot context aligned. */
  activeScenarioId?: string;
};

export function notifyWorkspaceMutated(detail?: WorkspaceMutatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_MUTATED_EVENT, { detail: detail ?? {} }));
}

export function onWorkspaceMutated(
  handler: (detail: WorkspaceMutatedDetail) => void
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<WorkspaceMutatedDetail>).detail ?? {});
  };
  window.addEventListener(WORKSPACE_MUTATED_EVENT, listener);
  return () => window.removeEventListener(WORKSPACE_MUTATED_EVENT, listener);
}

/** Tools that mutate persisted workspace state and should refresh the open UI. */
export const WORKSPACE_MUTATING_TOOLS = new Set([
  "start_planning_project",
  "set_planning_objective",
  "set_transit_threshold",
  "set_priority_weights",
  "run_analysis",
  "create_scenario_branch",
  "select_candidate",
  "add_to_shortlist",
  "remove_from_shortlist",
  "exclude_map_area",
  "exclude_features",
  "remove_map_area",
  "update_map_area",
  "set_map_view",
  "stage_proposal",
  "reject_candidate",
  "prefer_scenario",
  "approve_scenario",
  "approve_proposal",
  "generate_report",
]);

export function compareScenariosToolDetail(
  args: Record<string, unknown>,
  result: unknown,
  projectId?: string
): WorkspaceMutatedDetail | null {
  if (!Array.isArray(args.scenarioIds) || args.scenarioIds.length < 2) return null;
  const scenarioIds = args.scenarioIds.filter((id): id is string => typeof id === "string");
  if (scenarioIds.length < 2) return null;
  const payload = (result ?? {}) as CompareScenariosToolPayload;
  return {
    tool: "compare_scenarios",
    projectId:
      projectId ??
      (typeof args.projectId === "string" ? args.projectId : undefined) ??
      (result &&
      typeof result === "object" &&
      result !== null &&
      "projectId" in result &&
      typeof (result as { projectId?: unknown }).projectId === "string"
        ? (result as { projectId: string }).projectId
        : undefined),
    openTab: "compare",
    compareScenarioIds: scenarioIds,
    comparePayload: payload,
  };
}

export function mutationDetailFromToolResult(
  name: string,
  args: Record<string, unknown>,
  result: unknown,
  projectId?: string
): WorkspaceMutatedDetail | null {
  if (!WORKSPACE_MUTATING_TOOLS.has(name)) return null;
  const status = (result as { status?: string } | null)?.status;
  if (status === "pending_human" || status === "pending_planner") {
    return null;
  }
  const payload = (result ?? {}) as {
    note?: string;
    criteriaStale?: boolean;
    workspaceUrl?: string;
    center?: [number, number];
    zoom?: number;
  };
  const note = payload.note;
  const criteriaStale =
    payload.criteriaStale === true ||
    (typeof note === "string" && /stale|recalculate/i.test(note));
  const resolvedProjectId =
    projectId ??
    (typeof args.projectId === "string" ? args.projectId : undefined) ??
    (result &&
    typeof result === "object" &&
    result !== null &&
    "projectId" in result &&
    typeof (result as { projectId?: unknown }).projectId === "string"
      ? (result as { projectId: string }).projectId
      : undefined);

  const detail: WorkspaceMutatedDetail = {
    tool: name,
    projectId: resolvedProjectId,
    resumeNote: note,
    criteriaStale,
    mapViewport:
      name === "set_map_view" &&
      Array.isArray(payload.center) &&
      payload.center.length >= 2
        ? {
            center: payload.center as [number, number],
            zoom: typeof payload.zoom === "number" ? payload.zoom : 14,
          }
        : undefined,
  };

  if (name === "create_scenario_branch") {
    const activeScenarioId = (result as { activeScenarioId?: string } | null)?.activeScenarioId;
    if (activeScenarioId) {
      detail.activeScenarioId = activeScenarioId;
    }
  }

  return detail;
}

export function workspaceToolEventDetail(
  name: string,
  args: Record<string, unknown>,
  result: unknown,
  projectId?: string
): WorkspaceMutatedDetail | null {
  const mutation = mutationDetailFromToolResult(name, args, result, projectId);
  const compare =
    name === "compare_scenarios"
      ? compareScenariosToolDetail(args, result, projectId ?? mutation?.projectId)
      : null;
  if (!mutation && !compare) return null;
  return { ...(mutation ?? {}), ...(compare ?? {}) };
}
