/**
 * Browser WebMCP tool registration for Urban Planning Copilot.
 * Tools share catalog with HTTP /api/mcp via tool-definitions.ts.
 */
import { PLANNING_TOOL_META } from "./tool-definitions";
import {
  getModelContext,
  type JsonSchema,
  type ModelContextClient,
  type WebMcpToolDefinition,
} from "./browser-types";
import { formatToolErrorMessage } from "@/lib/domain/tool-errors";
import type { ToolErrorPayload } from "@/lib/domain/tool-errors";
import { parseToolArguments } from "@/lib/domain/webmcp-validation";
import {
  notifyWorkspaceMutated,
  WORKSPACE_MUTATING_TOOLS,
} from "@/lib/workspace-sync";

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { error?: string | ToolErrorPayload };
    if (err.error && typeof err.error === "object" && "message" in err.error) {
      throw new Error(formatToolErrorMessage(err.error as ToolErrorPayload));
    }
    throw new Error(
      typeof err.error === "string"
        ? err.error
        : `Request failed (${res.status})`
    );
  }
  return data;
}

function truncate(value: unknown, max = 1400): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: truncate(payload) }] };
}

async function confirmSensitive(
  client: ModelContextClient | undefined,
  message: string
): Promise<boolean> {
  if (client?.requestUserInteraction) {
    return Boolean(
      await client.requestUserInteraction(async () => window.confirm(message))
    );
  }
  return window.confirm(message);
}

async function invokeMcpTool(name: string, rawArgs: Record<string, unknown>) {
  const args = parseToolArguments(rawArgs);
  const res = await api("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ tool: name, arguments: args }),
  });
  const data = res as {
    ok?: boolean;
    result?: unknown;
    error?: string | ToolErrorPayload;
    projectId?: string;
  };
  if (data.ok === false) {
    const message =
      data.error && typeof data.error === "object"
        ? formatToolErrorMessage(data.error)
        : typeof data.error === "string"
          ? data.error
          : "Tool failed";
    throw new Error(message);
  }
  if (WORKSPACE_MUTATING_TOOLS.has(name)) {
    notifyWorkspaceMutated({
      tool: name,
      projectId:
        data.projectId ??
        (typeof args.projectId === "string" ? args.projectId : undefined) ??
        (data.result &&
        typeof data.result === "object" &&
        data.result !== null &&
        "projectId" in data.result &&
        typeof (data.result as { projectId?: unknown }).projectId === "string"
          ? (data.result as { projectId: string }).projectId
          : undefined),
    });
  }
  return data.result ?? data;
}

export type WebMcpRegistration = {
  abort: () => void;
  available: boolean;
  toolCount: number;
};

export function getPlanningToolSchemas(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpToolDefinition["annotations"];
  layer: "answer" | "action" | "sensitive";
}> {
  return PLANNING_TOOL_META;
}

const SENSITIVE_TOOLS = new Set([
  "reject_candidate",
  "prefer_scenario",
  "approve_scenario",
  "approve_proposal",
  "generate_report",
]);

const CONFIRM_MESSAGES: Record<string, (input: Record<string, unknown>) => string> = {
  reject_candidate: (input) =>
    `Reject candidate ${input.candidateId}?${input.reason ? `\nReason: ${input.reason}` : ""}\n\nThis is recorded as a planner decision.`,
  prefer_scenario: (input) =>
    `Prefer scenario ${input.scenarioId} as the planner's selection?`,
  approve_scenario: (input) =>
    `Approve scenario ${input.scenarioId} as a formal planning decision?\n\nThis records your human decision — not an authoritative AI fact.`,
  approve_proposal: (input) =>
    `Apply staged proposal ${input.proposalId}?\n\nThis commits the exact staged change. Rejects if criteria changed since staging.`,
  generate_report: (input) =>
    `Generate a planning report for ${Array.isArray(input.scenarioIds) ? (input.scenarioIds as string[]).length : 0} scenario(s)?`,
};

export async function registerPlanningWebMcpTools(options?: {
  projectId?: string | null;
}): Promise<WebMcpRegistration> {
  const ctx = getModelContext();
  const controller = new AbortController();
  if (!ctx) {
    return { abort: () => undefined, available: false, toolCount: 0 };
  }

  const tools: WebMcpToolDefinition[] = PLANNING_TOOL_META.map((meta) => ({
    name: meta.name,
    description: meta.description,
    inputSchema: meta.inputSchema,
    annotations: meta.annotations,
    execute: async (input, client) => {
      const parsedInput = parseToolArguments(input);
      if (SENSITIVE_TOOLS.has(meta.name)) {
        const msg = CONFIRM_MESSAGES[meta.name]?.(parsedInput) ?? `Confirm ${meta.name}?`;
        const confirmed = await confirmSensitive(client, msg);
        if (!confirmed) throw new Error(`${meta.name} cancelled by planner`);
      }
      const result = await invokeMcpTool(meta.name, parsedInput);
      return ok(result);
    },
  }));

  for (const tool of tools) {
    await ctx.registerTool(tool, { signal: controller.signal });
  }

  if (typeof window !== "undefined") {
    (window as unknown as { __UPC_WEBMCP_TOOLS__?: unknown }).__UPC_WEBMCP_TOOLS__ =
      PLANNING_TOOL_META;
  }

  void options;

  return {
    available: true,
    toolCount: tools.length,
    abort: () => controller.abort(),
  };
}
