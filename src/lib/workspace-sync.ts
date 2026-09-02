/** Browser event bus so WebMCP tool mutations refresh open workspace UI without reload. */
export const WORKSPACE_MUTATED_EVENT = "upc:workspace-mutated";

export type WorkspaceMutatedDetail = {
  projectId?: string;
  tool?: string;
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
