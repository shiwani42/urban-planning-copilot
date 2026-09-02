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
