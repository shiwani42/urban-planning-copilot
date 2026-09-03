export const WORKSPACE_TABS = [
  "workspace",
  "results",
  "evidence",
  "compare",
  "decision",
  "activity",
  "report",
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function resolveWorkspaceTab(value?: string | null): WorkspaceTab {
  if (value && (WORKSPACE_TABS as readonly string[]).includes(value)) {
    return value as WorkspaceTab;
  }
  return "workspace";
}

/** Resolve tab from `?tab=`, legacy `?initialTab=`, or `/workspace/:id/:tab` path segment. */
export function resolveWorkspaceTabFromParams(params: {
  tab?: string | null;
  initialTab?: string | null;
  pathTab?: string | null;
}): WorkspaceTab {
  return resolveWorkspaceTab(params.tab ?? params.initialTab ?? params.pathTab);
}

/** Read the tab segment from `/workspace/:id/:tab` (null on the base workspace path). */
export function parseWorkspacePathTab(pathname: string): WorkspaceTab | null {
  const match = pathname.match(/^\/workspace\/[^/]+\/([^/?#]+)/);
  if (!match?.[1]) return null;
  const segment = match[1];
  if (!(WORKSPACE_TABS as readonly string[]).includes(segment)) return null;
  return segment as WorkspaceTab;
}

export function parseCompareScenarioIds(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function serializeCompareScenarioIds(ids: string[]): string | undefined {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  return unique.length >= 2 ? unique.join(",") : undefined;
}

export type WorkspaceTabQuery = {
  scenarioId?: string | null;
  compareScenarioIds?: string[] | null;
};

/** Path-based tab URLs; `?tab=` and legacy `?initialTab=` still resolve via `resolveWorkspaceTabFromParams`. */
export function workspaceTabHref(projectId: string, tab: WorkspaceTab): string {
  if (tab === "workspace") return `/workspace/${projectId}`;
  return `/workspace/${projectId}/${tab}`;
}

/** Path tab URL with optional deep-link query params (`scenarioId`, `compareScenarioIds`). */
export function workspaceTabUrl(
  projectId: string,
  tab: WorkspaceTab,
  query?: WorkspaceTabQuery
): string {
  const base = workspaceTabHref(projectId, tab);
  const params = new URLSearchParams();
  if (query?.scenarioId) params.set("scenarioId", query.scenarioId);
  const compare = serializeCompareScenarioIds(query?.compareScenarioIds ?? []);
  if (compare && tab === "compare") params.set("compareScenarioIds", compare);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Alt+1 … Alt+7 switch workspace tabs (matches tab bar order). */
export const WORKSPACE_TAB_KEYBOARD_SHORTCUTS: ReadonlyArray<{
  tab: WorkspaceTab;
  key: string;
  label: string;
}> = [
  { tab: "workspace", key: "1", label: "Workspace" },
  { tab: "results", key: "2", label: "Results" },
  { tab: "evidence", key: "3", label: "Evidence" },
  { tab: "compare", key: "4", label: "Compare" },
  { tab: "decision", key: "5", label: "Decision" },
  { tab: "activity", key: "6", label: "Activity" },
  { tab: "report", key: "7", label: "Report" },
];
