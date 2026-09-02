import WorkspaceClient from "../workspace-client";

const VALID_TABS = [
  "workspace",
  "results",
  "evidence",
  "compare",
  "decision",
  "activity",
  "report",
] as const;

type WorkspaceTab = (typeof VALID_TABS)[number];

export default async function WorkspaceTabPage({
  params,
}: {
  params: Promise<{ projectId: string; tab: string }>;
}) {
  const { projectId, tab } = await params;
  const initialTab: WorkspaceTab = (VALID_TABS as readonly string[]).includes(tab)
    ? (tab as WorkspaceTab)
    : "workspace";
  return <WorkspaceClient projectId={projectId} initialTab={initialTab} />;
}
