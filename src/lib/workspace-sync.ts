/** Browser event bus so WebMCP tool mutations refresh open workspace UI without reload. */
export const WORKSPACE_MUTATED_EVENT = "upc:workspace-mutated";

export type WorkspaceMutatedDetail = {
  projectId?: string;
  tool?: string;
  resumeNote?: string;
  criteriaStale?: boolean;
  mapViewport?: { center: [number, number]; zoom: number };
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
  "exclude_map_area",
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
  return {
    tool: name,
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
}
