import { PLANNING_TOOL_META } from "@/lib/webmcp/tool-definitions";

export type CopilotToolGroupId = "map" | "analysis" | "scenarios" | "reports" | "projects";

export type CopilotToolGroup = {
  id: CopilotToolGroupId;
  label: string;
  tools: string[];
};

const TOOL_GROUP_BY_NAME: Record<string, CopilotToolGroupId> = {
  set_map_view: "map",
  exclude_map_area: "map",
  exclude_features: "map",
  remove_map_area: "map",
  update_map_area: "map",
  get_analysis_plan: "analysis",
  list_candidates: "analysis",
  inspect_candidate: "analysis",
  list_shortlist: "analysis",
  add_to_shortlist: "analysis",
  remove_from_shortlist: "analysis",
  run_analysis: "analysis",
  list_datasets: "analysis",
  get_planning_constraints: "analysis",
  list_decisions: "scenarios",
  verify_operation: "analysis",
  get_workspace: "scenarios",
  list_scenarios: "scenarios",
  set_active_scenario: "scenarios",
  open_workspace_tab: "scenarios",
  set_planning_objective: "scenarios",
  set_transit_threshold: "scenarios",
  set_priority_weights: "scenarios",
  create_scenario_branch: "scenarios",
  select_candidate: "scenarios",
  compare_scenarios: "scenarios",
  reject_candidate: "scenarios",
  prefer_scenario: "scenarios",
  approve_scenario: "scenarios",
  stage_proposal: "scenarios",
  approve_proposal: "scenarios",
  generate_report: "reports",
  start_planning_project: "projects",
  open_project: "projects",
};

const GROUP_LABELS: Record<CopilotToolGroupId, string> = {
  map: "Map",
  analysis: "Analysis",
  scenarios: "Scenarios",
  reports: "Reports",
  projects: "Projects",
};

const GROUP_ORDER: CopilotToolGroupId[] = [
  "map",
  "analysis",
  "scenarios",
  "reports",
  "projects",
];

export function groupIdForTool(toolName: string): CopilotToolGroupId {
  return TOOL_GROUP_BY_NAME[toolName] ?? "analysis";
}

export function buildCopilotToolGroups(options?: {
  includeProjects?: boolean;
}): CopilotToolGroup[] {
  const includeProjects = options?.includeProjects ?? false;
  const byGroup = new Map<CopilotToolGroupId, string[]>();

  for (const meta of PLANNING_TOOL_META) {
    const groupId = groupIdForTool(meta.name);
    if (groupId === "projects" && !includeProjects) continue;
    const list = byGroup.get(groupId) ?? [];
    list.push(meta.name);
    byGroup.set(groupId, list);
  }

  return GROUP_ORDER.filter((id) => byGroup.has(id)).map((id) => ({
    id,
    label: GROUP_LABELS[id],
    tools: byGroup.get(id) ?? [],
  }));
}

export function toolLabel(toolName: string): string {
  return toolName.replace(/_/g, " ");
}
