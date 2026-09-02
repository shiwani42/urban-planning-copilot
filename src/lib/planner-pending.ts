/** Client-side queue for human-gated WebMCP actions awaiting planner approval. */
export const PLANNER_PENDING_EVENT = "upc:planner-pending";

export type PendingPlannerAction = {
  id: string;
  projectId: string;
  tool: string;
  args: Record<string, unknown>;
  message: string;
  proposalId?: string;
  scenarioId?: string;
  candidateId?: string;
  title?: string;
  createdAt: number;
};

const pendingByProject = new Map<string, PendingPlannerAction[]>();

function actionKey(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    tool,
    projectId: args.projectId,
    proposalId: args.proposalId,
    scenarioId: args.scenarioId,
    candidateId: args.candidateId,
    scenarioIds: args.scenarioIds,
    title: args.title,
  });
}

export function listPendingPlannerActions(projectId: string): PendingPlannerAction[] {
  return [...(pendingByProject.get(projectId) ?? [])];
}

export function registerPendingPlannerAction(
  action: Omit<PendingPlannerAction, "id" | "createdAt"> & { id?: string }
): PendingPlannerAction {
  const entry: PendingPlannerAction = {
    ...action,
    id: action.id ?? `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  const list = pendingByProject.get(action.projectId) ?? [];
  const key = actionKey(entry.tool, entry.args);
  const withoutDup = list.filter((item) => actionKey(item.tool, item.args) !== key);
  withoutDup.push(entry);
  pendingByProject.set(action.projectId, withoutDup);
  dispatchPending(action.projectId);
  return entry;
}

export function clearPendingPlannerAction(projectId: string, id: string): void {
  const list = pendingByProject.get(projectId);
  if (!list) return;
  const next = list.filter((item) => item.id !== id);
  if (next.length) pendingByProject.set(projectId, next);
  else pendingByProject.delete(projectId);
  dispatchPending(projectId);
}

export function clearPendingPlannerActions(projectId: string): void {
  pendingByProject.delete(projectId);
  dispatchPending(projectId);
}

function dispatchPending(projectId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PLANNER_PENDING_EVENT, {
      detail: { projectId, actions: listPendingPlannerActions(projectId) },
    })
  );
}

export function onPlannerPending(
  handler: (detail: { projectId: string; actions: PendingPlannerAction[] }) => void
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<{ projectId: string; actions: PendingPlannerAction[] }>).detail);
  };
  window.addEventListener(PLANNER_PENDING_EVENT, listener);
  return () => window.removeEventListener(PLANNER_PENDING_EVENT, listener);
}
