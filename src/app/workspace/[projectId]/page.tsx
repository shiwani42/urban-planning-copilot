import { Suspense } from "react";
import WorkspaceClient from "./workspace-client";
import { resolveWorkspaceTabFromParams } from "@/lib/workspace-tabs";

function WorkspaceFallback() {
  return (
    <div
      className="h-screen flex flex-col bg-background overflow-hidden"
      aria-busy="true"
      aria-label="Loading workspace"
    >
      <div className="h-14 border-b border-outline-variant bg-surface-container-high px-section-padding flex items-center gap-4 shrink-0">
        <div className="h-5 w-48 bg-surface-variant rounded animate-pulse" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-body-sm text-on-surface-variant p-8">
        <span className="material-symbols-outlined animate-spin text-primary text-[28px]">
          progress_activity
        </span>
        <p className="font-medium text-on-surface">Preparing workspace…</p>
        <p className="text-caption text-center max-w-md">
          Connecting to project storage and loading the planning map.
        </p>
      </div>
    </div>
  );
}

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; initialTab?: string }>;
}) {
  const { projectId } = await params;
  const { tab, initialTab } = await searchParams;
  return (
    <Suspense fallback={<WorkspaceFallback />}>
      <WorkspaceClient
        projectId={projectId}
        initialTab={resolveWorkspaceTabFromParams({ tab, initialTab })}
      />
    </Suspense>
  );
}
