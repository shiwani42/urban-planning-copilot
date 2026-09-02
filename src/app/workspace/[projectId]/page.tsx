import { Suspense } from "react";
import WorkspaceClient from "./workspace-client";
import { resolveWorkspaceTab } from "@/lib/workspace-tabs";

function WorkspaceFallback() {
  return (
    <div className="h-screen flex items-center justify-center bg-background text-on-surface-variant text-body-sm">
      Loading workspace…
    </div>
  );
}

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ initialTab?: string }>;
}) {
  const { projectId } = await params;
  const { initialTab } = await searchParams;
  return (
    <Suspense fallback={<WorkspaceFallback />}>
      <WorkspaceClient
        projectId={projectId}
        initialTab={resolveWorkspaceTab(initialTab)}
      />
    </Suspense>
  );
}
