import { Suspense } from "react";
import WorkspaceClient from "../workspace-client";
import { resolveWorkspaceTabFromParams, WORKSPACE_TABS } from "@/lib/workspace-tabs";

type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

function WorkspaceFallback() {
  return (
    <div className="h-screen flex items-center justify-center bg-background text-on-surface-variant text-body-sm">
      Loading workspace…
    </div>
  );
}

export default async function WorkspaceTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; tab: string }>;
  searchParams: Promise<{ tab?: string; initialTab?: string }>;
}) {
  const { projectId, tab } = await params;
  const { tab: queryTab, initialTab } = await searchParams;
  const pathTab: WorkspaceTab = (WORKSPACE_TABS as readonly string[]).includes(tab)
    ? (tab as WorkspaceTab)
    : "workspace";
  const resolvedTab = resolveWorkspaceTabFromParams({
    tab: queryTab,
    initialTab,
    pathTab,
  });
  return (
    <Suspense fallback={<WorkspaceFallback />}>
      <WorkspaceClient projectId={projectId} initialTab={resolvedTab} />
    </Suspense>
  );
}
