/** Tools that require explicit planner confirmation before mutating state via WebMCP. */
export const HUMAN_GATED_TOOLS = new Set([
  "approve_proposal",
  "approve_scenario",
  "prefer_scenario",
  "reject_candidate",
  "generate_report",
]);

export type PendingPlannerResult = {
  status: "pending_planner";
  tool: string;
  message: string;
  proposalId?: string;
  scenarioId?: string;
  candidateId?: string;
  scenarioIds?: string[];
  title?: string;
};

/** @deprecated Use PendingPlannerResult */
export type PendingHumanResult = PendingPlannerResult & { status: "pending_human" };

export function isPlannerConfirmed(input: Record<string, unknown>): boolean {
  return input.confirmed === true;
}

export function pendingPlannerResult(
  tool: string,
  input: Record<string, unknown>,
  extra?: { title?: string; message?: string }
): PendingPlannerResult {
  const scenarioIds = Array.isArray(input.scenarioIds)
    ? (input.scenarioIds as unknown[]).map((id) => String(id))
    : undefined;
  return {
    status: "pending_planner",
    tool,
    message:
      extra?.message ??
      "Waiting for planner — use the workspace Approve/Reject banner or call again with confirmed:true after human approval.",
    proposalId: typeof input.proposalId === "string" ? input.proposalId : undefined,
    scenarioId: typeof input.scenarioId === "string" ? input.scenarioId : undefined,
    candidateId: typeof input.candidateId === "string" ? input.candidateId : undefined,
    scenarioIds,
    title: extra?.title,
  };
}

/** Back-compat alias */
export const pendingHumanResult = (
  tool: string,
  input: Record<string, unknown>,
  extra?: { title?: string; message?: string }
): PendingPlannerResult => pendingPlannerResult(tool, input, extra);

export function requiresPlannerConfirmation(tool: string, input: Record<string, unknown>): boolean {
  return HUMAN_GATED_TOOLS.has(tool) && !isPlannerConfirmed(input);
}

export function isPendingPlannerResult(
  result: unknown
): result is PendingPlannerResult {
  return (
    !!result &&
    typeof result === "object" &&
    (result as { status?: string }).status === "pending_planner"
  );
}
