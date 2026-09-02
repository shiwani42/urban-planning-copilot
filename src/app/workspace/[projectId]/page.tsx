import WorkspaceClient from "./workspace-client";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <WorkspaceClient projectId={projectId} initialTab="workspace" />;
}
