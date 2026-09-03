/** Legacy / challenge aliases — map to canonical planning tools (client + server safe). */
export const PLANNING_TOOL_ALIASES: Record<string, string> = {
  load_project: "get_workspace",
  exclude_from_selection: "exclude_features",
};

export function resolvePlanningToolAlias(name: string): string {
  return PLANNING_TOOL_ALIASES[name] ?? name;
}

export function isAliasPlanningTool(name: string): boolean {
  return name === "list_projects" || name in PLANNING_TOOL_ALIASES;
}
