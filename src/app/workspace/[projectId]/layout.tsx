import { Suspense } from "react";
import { WORKSPACE_LAYOUT_LOADING_DETAIL } from "@/lib/planner-copy";
import WorkspaceClient from "./workspace-client";

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
          {WORKSPACE_LAYOUT_LOADING_DETAIL}
        </p>
      </div>
    </div>
  );
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <Suspense fallback={<WorkspaceFallback />}>
      <WorkspaceClient projectId={projectId} />
      {children}
    </Suspense>
  );
}
