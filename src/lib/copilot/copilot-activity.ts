/** Client-side feed for in-app Urban Planning Copilot tool runs. */

export const COPILOT_ACTIVITY_EVENT = "upc:copilot-activity";

export type CopilotActivityStatus = "running" | "success" | "error";

export type CopilotActivityFollowUp = {
  label: string;
  tool: string;
  args?: Record<string, unknown>;
};

export type CopilotActivityEntry = {
  id: string;
  tool: string;
  query?: string;
  status: CopilotActivityStatus;
  summary: string;
  detail?: string;
  followUp?: CopilotActivityFollowUp;
  timestamp: string;
};

const MAX_ENTRIES = 40;
const entries: CopilotActivityEntry[] = [];

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COPILOT_ACTIVITY_EVENT, {
      detail: { entries: listCopilotActivity() },
    })
  );
}

export function listCopilotActivity(): CopilotActivityEntry[] {
  return entries.slice();
}

export function clearCopilotActivity(): void {
  entries.length = 0;
  emit();
}

export function appendCopilotActivity(
  entry: Omit<CopilotActivityEntry, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
    followUp?: CopilotActivityFollowUp;
  }
): CopilotActivityEntry {
  const full: CopilotActivityEntry = {
    id: entry.id ?? `copilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    tool: entry.tool,
    query: entry.query,
    status: entry.status,
    summary: entry.summary,
    detail: entry.detail,
    followUp: entry.followUp,
  };
  entries.unshift(full);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  emit();
  return full;
}

export function updateCopilotActivity(
  id: string,
  patch: Partial<
    Pick<CopilotActivityEntry, "status" | "summary" | "detail" | "followUp">
  >
): void {
  const item = entries.find((e) => e.id === id);
  if (!item) return;
  Object.assign(item, patch);
  emit();
}

export function onCopilotActivity(
  handler: (detail: { entries: CopilotActivityEntry[] }) => void
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<{ entries: CopilotActivityEntry[] }>).detail);
  };
  window.addEventListener(COPILOT_ACTIVITY_EVENT, listener);
  return () => window.removeEventListener(COPILOT_ACTIVITY_EVENT, listener);
}
