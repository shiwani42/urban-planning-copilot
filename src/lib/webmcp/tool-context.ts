import { ToolError } from "@/lib/domain/tool-errors";

export type ToolExecutionContext = {
  projectId?: string;
  scenarioId?: string;
};

export function mergeToolContext(
  args: Record<string, unknown>,
  context?: ToolExecutionContext
): Record<string, unknown> {
  const merged = { ...args };
  if (!merged.projectId && context?.projectId) {
    merged.projectId = context.projectId;
  }
  if (!merged.scenarioId && context?.scenarioId) {
    merged.scenarioId = context.scenarioId;
  }
  return merged;
}

export function resolveProjectId(
  input: Record<string, unknown>,
  context?: ToolExecutionContext
): string {
  const fromInput =
    typeof input.projectId === "string" && input.projectId.trim()
      ? input.projectId.trim()
      : undefined;
  const projectId = fromInput ?? context?.projectId?.trim();
  if (!projectId) {
    throw new ToolError(
      "MISSING_FIELD",
      "projectId is required — open a workspace tab or pass projectId explicitly",
      "projectId"
    );
  }
  return projectId;
}

export async function resolveScenarioId(
  projectId: string,
  input: Record<string, unknown>,
  getWorkspace: (id: string) => Promise<{ project: { activeScenarioId?: string | null }; scenarios: { id: string }[] } | null>
): Promise<string> {
  const fromInput =
    typeof input.scenarioId === "string" && input.scenarioId.trim()
      ? input.scenarioId.trim()
      : undefined;
  if (fromInput) return fromInput;

  const ws = await getWorkspace(projectId);
  if (!ws) {
    throw new ToolError("NOT_FOUND", "Project not found", "projectId");
  }
  const active =
    ws.project.activeScenarioId ?? ws.scenarios[0]?.id;
  if (!active) {
    throw new ToolError("NOT_FOUND", "No scenario found for project", "scenarioId");
  }
  return active;
}
