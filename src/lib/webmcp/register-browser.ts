/**
 * Browser WebMCP tool registration for Urban Planning Copilot.
 * Tools share catalog with HTTP /api/mcp via tool-definitions.ts.
 */
import { PLANNING_TOOL_META } from "./tool-definitions";
import {
  getModelContext,
  type JsonSchema,
  type WebMcpToolDefinition,
} from "./browser-types";
import { formatToolErrorMessage } from "@/lib/domain/tool-errors";
import type { ToolErrorPayload } from "@/lib/domain/tool-errors";
import { parseToolArguments } from "@/lib/domain/webmcp-validation";
import { isPendingPlannerResult } from "@/lib/domain/human-gated-tools";
import {
  registerPendingPlannerAction,
  clearPendingPlannerAction,
} from "@/lib/planner-pending";
import {
  mutationDetailFromToolResult,
  notifyWorkspaceMutated,
} from "@/lib/workspace-sync";
import { resolveWebMcpBrowserContext } from "./browser-context";

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

function mergeArgsWithBrowserContext(rawArgs: Record<string, unknown>) {
  const args = parseToolArguments(rawArgs);
  const ctx = resolveWebMcpBrowserContext();
  return {
    args: {
      ...args,
      ...(args.projectId ? {} : ctx.projectId ? { projectId: ctx.projectId } : {}),
      ...(args.scenarioId ? {} : ctx.scenarioId ? { scenarioId: ctx.scenarioId } : {}),
    },
    context: ctx,
  };
}

async function navigateToWorkspace(result: unknown) {
  if (typeof window === "undefined") return;
  const payload = (result ?? {}) as { projectId?: string; workspaceUrl?: string };
  const path =
    payload.workspaceUrl ??
    (payload.projectId ? `/workspace/${payload.projectId}` : null);
  if (!path) return;
  const target = path.startsWith("/") ? path : `/${path}`;

  if (payload.projectId) {
    const verify = await fetch(`/api/projects/${payload.projectId}`, {
      cache: "no-store",
    });
    if (!verify.ok) {
      throw new Error(
        `Workspace was not saved on the server (project ${payload.projectId} not found). Retry create when storage is healthy.`
      );
    }
  }

  if (!window.location.pathname.startsWith(target)) {
    window.location.assign(target);
  }
}

/** Invoke a planning tool from in-app copilot or browser WebMCP registration. */
export async function invokePlanningTool(
  name: string,
  rawArgs: Record<string, unknown> = {}
): Promise<unknown> {
  return invokeMcpTool(name, rawArgs);
}

async function invokeMcpTool(name: string, rawArgs: Record<string, unknown>) {
  const { args, context } = mergeArgsWithBrowserContext(rawArgs);
  const res = await api("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ tool: name, arguments: args, context }),
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
  const result = data.result ?? data;

  if (isPendingPlannerResult(result)) {
    const projectId =
      (typeof args.projectId === "string" ? args.projectId : undefined) ??
      context.projectId;
    if (projectId) {
      registerPendingPlannerAction({
        projectId,
        tool: result.tool,
        args,
        message: result.message,
        proposalId: result.proposalId,
        scenarioId: result.scenarioId,
        candidateId: result.candidateId,
        title: result.title,
      });
    }
    return result;
  }

  const mutation = mutationDetailFromToolResult(
    name,
    args,
    result,
    data.projectId ??
      (typeof args.projectId === "string" ? args.projectId : context.projectId)
  );
  if (mutation) {
    notifyWorkspaceMutated(mutation);
  }
  if (name === "start_planning_project") {
    navigateToWorkspace(result);
  }
  return result;
}

/** Resolve a pending planner action after the human clicks Approve in the workspace banner. */
export async function resolvePendingPlannerAction(
  pendingId: string,
  projectId: string,
  approve: boolean
): Promise<unknown> {
  const { listPendingPlannerActions } = await import("@/lib/planner-pending");
  const action = listPendingPlannerActions(projectId).find((item) => item.id === pendingId);
  if (!action) throw new Error("Pending planner action not found");
  clearPendingPlannerAction(projectId, pendingId);
  if (!approve) {
    return { status: "rejected_by_planner", tool: action.tool };
  }
  return invokeMcpTool(action.tool, { ...action.args, confirmed: true });
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

export async function registerPlanningWebMcpTools(): Promise<WebMcpRegistration> {
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
    execute: async (input) => {
      const result = await invokeMcpTool(meta.name, parseToolArguments(input));
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

  return {
    available: true,
    toolCount: tools.length,
    abort: () => controller.abort(),
  };
}
