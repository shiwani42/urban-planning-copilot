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
import { resolvePlanningToolAlias } from "@/lib/webmcp/tool-aliases";
import {
  assertBrowserToolProductState,
  coerceBrowserToolFailure,
  webMcpToolOk,
} from "@/lib/webmcp/tool-result";
import { getPageToolBudgetMs, runWithPageToolBudget } from "@/lib/webmcp/page-tool-budget";
import { isPendingPlannerResult } from "@/lib/domain/human-gated-tools";
import {
  registerPendingPlannerAction,
  clearPendingPlannerAction,
} from "@/lib/planner-pending";
import {
  notifyWorkspaceMutated,
  workspaceToolEventDetail,
  pendingPlannerNavigationDetail,
} from "@/lib/workspace-sync";
import { resolveWebMcpBrowserContext, setWebMcpBrowserContext } from "./browser-context";
import { parseMapCenter } from "@/lib/domain/map-center";
import { ToolError } from "@/lib/domain/tool-errors";
import {
  getBrowserWorkspaceSnapshot,
  listCandidatesFromBrowserCache,
} from "./browser-workspace-cache";
import { applyShortlistMutation } from "@/lib/domain/shortlist-optimistic";

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

function fireAndForgetPersist(name: string, args: Record<string, unknown>, context: {
  projectId?: string;
  scenarioId?: string;
}) {
  void api("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ tool: name, arguments: args, context }),
  }).catch(() => {
    notifyWorkspaceMutated({
      tool: name,
      projectId: context.projectId,
      persistFailed: true,
      skipRefresh: true,
    });
  });
}

async function invokeSetMapViewClientFirst(
  args: Record<string, unknown>,
  context: { projectId?: string; scenarioId?: string }
) {
  const [lng, lat] = parseMapCenter(args.center);
  const zoom = args.zoom == null ? undefined : Number(args.zoom);
  if (zoom != null && (!Number.isFinite(zoom) || zoom < 1 || zoom > 20)) {
    throw new ToolError("INVALID_INPUT", "zoom must be between 1 and 20", "zoom");
  }
  const projectId =
    (typeof args.projectId === "string" ? args.projectId : undefined) ?? context.projectId;
  const viewport = {
    center: [lng, lat] as [number, number],
    zoom: zoom ?? 14,
  };
  notifyWorkspaceMutated({
    tool: "set_map_view",
    projectId,
    mapViewport: viewport,
    skipRefresh: true,
  });
  fireAndForgetPersist("set_map_view", args, context);
  return {
    center: viewport.center,
    zoom: viewport.zoom,
    note: "Map viewport updated",
  };
}

async function invokeShortlistOptimistic(
  name: "add_to_shortlist" | "remove_from_shortlist",
  args: Record<string, unknown>,
  context: { projectId?: string; scenarioId?: string }
) {
  const candidateId = String(args.candidateId ?? "").trim();
  if (!candidateId) {
    throw new ToolError("MISSING_FIELD", "candidateId is required", "candidateId");
  }
  const projectId =
    (typeof args.projectId === "string" ? args.projectId : undefined) ?? context.projectId;
  const mutation = {
    action: (name === "add_to_shortlist" ? "pin" : "unpin") as "pin" | "unpin",
    candidateId,
    reason: typeof args.reason === "string" ? args.reason : undefined,
    note: typeof args.note === "string" ? args.note : undefined,
  };
  notifyWorkspaceMutated({
    tool: name,
    projectId,
    skipRefresh: true,
    shortlistMutation: mutation,
  });
  const cached = getBrowserWorkspaceSnapshot();
  const estimatedCount = cached
    ? applyShortlistMutation(cached, mutation).scenarios.find(
        (s) => s.id === (context.scenarioId ?? cached.project.activeScenarioId)
      )?.shortlist?.length
    : undefined;
  void api("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ tool: name, arguments: args, context }),
  })
    .then((res) => {
      const data = res as { ok?: boolean };
      if (data.ok === false) {
        throw new Error("Shortlist persist failed");
      }
    })
    .catch(() => {
      notifyWorkspaceMutated({
        tool: name,
        projectId,
        skipRefresh: true,
        persistFailed: true,
        shortlistMutation: {
          action: name === "add_to_shortlist" ? "unpin" : "pin",
          candidateId,
        },
      });
    });
  const countNote =
    estimatedCount != null
      ? ` (${estimatedCount} site${estimatedCount === 1 ? "" : "s"})`
      : "";
  return {
    candidateId,
    shortlistCount: estimatedCount,
    note:
      name === "add_to_shortlist"
        ? `Pinned to shortlist${countNote}`
        : `Removed from shortlist${countNote}`,
  };
}

async function invokeMcpTool(name: string, rawArgs: Record<string, unknown>) {
  const resolvedName =
    name === "list_projects" ? "list_projects" : resolvePlanningToolAlias(name);
  const { args, context } = mergeArgsWithBrowserContext(rawArgs);

  if (resolvedName === "set_map_view") {
    return invokeSetMapViewClientFirst(args, context);
  }
  if (resolvedName === "add_to_shortlist" || resolvedName === "remove_from_shortlist") {
    return invokeShortlistOptimistic(resolvedName, args, context);
  }
  if (resolvedName === "list_candidates") {
    const toolArgs = args as Record<string, unknown>;
    const local = listCandidatesFromBrowserCache({
      projectId:
        (typeof toolArgs.projectId === "string" ? toolArgs.projectId : undefined) ??
        context.projectId,
      scenarioId:
        (typeof toolArgs.scenarioId === "string" ? toolArgs.scenarioId : undefined) ??
        context.scenarioId,
      limit: toolArgs.limit == null ? undefined : Number(toolArgs.limit),
      offset: toolArgs.offset == null ? undefined : Number(toolArgs.offset),
    });
    if (local) return local;
  }

  const res = await api("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ tool: resolvedName, arguments: args, context }),
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
  assertBrowserToolProductState(name, result);

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
      const pendingNav = pendingPlannerNavigationDetail(result.tool, projectId);
      if (pendingNav) {
        notifyWorkspaceMutated(pendingNav);
      }
    }
    return result;
  }

  const resolvedProjectId =
    data.projectId ??
    (typeof args.projectId === "string" ? args.projectId : context.projectId);

  const toolEvent = workspaceToolEventDetail(name, args, result, resolvedProjectId);
  if (toolEvent) {
    notifyWorkspaceMutated(toolEvent);
  }

  if (name === "create_scenario_branch" && result && typeof result === "object") {
    const activeScenarioId = (result as { activeScenarioId?: string }).activeScenarioId;
    if (activeScenarioId) {
      setWebMcpBrowserContext({ scenarioId: activeScenarioId });
    }
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
      try {
        const result = await runWithPageToolBudget(() =>
          invokeMcpTool(meta.name, parseToolArguments(input))
        );
        return webMcpToolOk(result);
      } catch (err) {
        return coerceBrowserToolFailure(err);
      }
    },
  }));

  const aliasTools: WebMcpToolDefinition[] = [
    {
      name: "list_projects",
      description: "List saved planning projects on the server.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          return webMcpToolOk(
            await runWithPageToolBudget(() =>
              invokeMcpTool("list_projects", parseToolArguments(input))
            )
          );
        } catch (err) {
          return coerceBrowserToolFailure(err);
        }
      },
    },
    {
      name: "load_project",
      description: "Load a planning project workspace (alias for get_workspace).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description: "Planning project id",
          },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          return webMcpToolOk(
            await runWithPageToolBudget(() =>
              invokeMcpTool("load_project", parseToolArguments(input))
            )
          );
        } catch (err) {
          return coerceBrowserToolFailure(err);
        }
      },
    },
    {
      name: "exclude_from_selection",
      description: "Exclude parcel features from analysis (alias for exclude_features).",
      inputSchema:
        PLANNING_TOOL_META.find((tool) => tool.name === "exclude_features")?.inputSchema ?? {
          type: "object",
          properties: {},
        },
      execute: async (input) => {
        try {
          return webMcpToolOk(
            await runWithPageToolBudget(() =>
              invokeMcpTool("exclude_from_selection", parseToolArguments(input))
            )
          );
        } catch (err) {
          return coerceBrowserToolFailure(err);
        }
      },
    },
  ];

  for (const tool of [...tools, ...aliasTools]) {
    await ctx.registerTool(tool, { signal: controller.signal });
  }

  if (typeof window !== "undefined") {
    (window as unknown as { __UPC_WEBMCP_TOOLS__?: unknown }).__UPC_WEBMCP_TOOLS__ = [
      ...PLANNING_TOOL_META,
      ...aliasTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    ];
  }

  return {
    available: true,
    toolCount: tools.length + aliasTools.length,
    abort: () => controller.abort(),
  };
}
