/** Tools that require explicit planner confirmation before mutating state via WebMCP. */
export const HUMAN_GATED_TOOLS = new Set([
  "approve_proposal",
  "approve_scenario",
  "prefer_scenario",
  "reject_candidate",
]);

export type PendingHumanResult = {
  status: "pending_human";
  tool: string;
  message: string;
  proposalId?: string;
  scenarioId?: string;
  candidateId?: string;
  title?: string;
};

export function isPlannerConfirmed(input: Record<string, unknown>): boolean {
  return input.confirmed === true;
}

export function pendingHumanResult(
  tool: string,
  input: Record<string, unknown>,
  extra?: { title?: string; message?: string }
): PendingHumanResult {
  return {
    status: "pending_human",
    tool,
    message:
      extra?.message ??
      "Waiting for planner — use the workspace Approve/Reject controls or call again with confirmed:true after human approval.",
    proposalId: typeof input.proposalId === "string" ? input.proposalId : undefined,
    scenarioId: typeof input.scenarioId === "string" ? input.scenarioId : undefined,
    candidateId: typeof input.candidateId === "string" ? input.candidateId : undefined,
    title: extra?.title,
  };
}

export function requiresPlannerConfirmation(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "generate_report") return false;
  return HUMAN_GATED_TOOLS.has(tool) && !isPlannerConfirmed(input);
}
