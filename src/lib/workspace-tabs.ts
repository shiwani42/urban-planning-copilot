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

export function workspaceTabHref(projectId: string, tab: WorkspaceTab): string {
  if (tab === "workspace") return `/workspace/${projectId}`;
  return `/workspace/${projectId}?tab=${tab}`;
}
