/**
 * Browser WebMCP tool registration for Urban Planning Copilot.
 *
 * Designed from outcomes (not API wrapping), per:
 * https://webmcp.com/blog/building-user-journeys-with-webmcp
 *
 * Core outcome: an auditable planner decision on a scenario.
 *
 * Journey chain:
 *   understand objective → review plan → run analysis → inspect evidence
 *   → adjust criteria → branch/compare scenarios → approve decision
 *
 * Tool layers:
 *   Answer  — read-only (readOnlyHint)
 *   Action  — mutate working state without final commitment
 *   Sensitive — commitment/decision; uses requestUserInteraction
 *
 * Spec/docs: docs/documentation.md
 */

import {
  getModelContext,
  type JsonSchema,
  type ModelContextClient,
  type WebMcpToolDefinition,
} from "./browser-types";

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
    throw new Error(
      typeof (data as { error?: string }).error === "string"
        ? (data as { error: string }).error
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
      await client.requestUserInteraction(async () => {
        // Prefer in-page confirm; agents pause until this resolves.
        return window.confirm(message);
      })
    );
  }
  // Fallback when WebMCP client interaction is unavailable (smoke/HTTP).
  return window.confirm(message);
}

function activeContext(ws: {
  project: { id: string; name: string; activeScenarioId?: string; resumeNote?: string };
  scenarios: Array<{
    id: string;
    name: string;
    objective: { rawText: string; intent: string; parsedRequirements: string[] };
    decisionStatus: string;
    latestResultId?: string;
    analysisPlan?: { steps: Array<{ order: number; label: string; purpose: string }> };
    constraints: Array<{ label: string; enabled: boolean }>;
    weights: Array<{ key: string; label: string; weight: number }>;
  }>;
  analysisResults: Array<{
    id: string;
    summary: string;
    stale: boolean;
    candidates: Array<{
      id: string;
      label: string;
      score: number;
      rank: number;
      status: string;
      metrics: Array<{ key: string; value: number; unit?: string }>;
      provenance: unknown;
    }>;
    limitations: string[];
  }>;
}) {
  const scenario = ws.scenarios.find((s) => s.id === ws.project.activeScenarioId) ?? ws.scenarios[0];
  const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
  return { scenario, result };
}

export type WebMcpRegistration = {
  abort: () => void;
  available: boolean;
  toolCount: number;
};

/** Static schema export shape for webmcp-evals `local` mode */
export function getPlanningToolSchemas(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpToolDefinition["annotations"];
  layer: "answer" | "action" | "sensitive";
}> {
  return PLANNING_TOOL_META;
}

const PLANNING_TOOL_META: Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpToolDefinition["annotations"];
  layer: "answer" | "action" | "sensitive";
}> = [
  // —— Answer tools ——
  {
    layer: "answer",
    name: "get_workspace",
    description:
      "Read the active project/scenario: objective, constraints, decision status, resume note.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project id" },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "get_analysis_plan",
    description: "Return the structured analysis plan steps before or after running analysis.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string", description: "Optional; defaults to active scenario" },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "list_candidates",
    description: "List ranked analysis candidates with scores and statuses for a scenario.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
        limit: { type: "number", description: "Max candidates (default 10)" },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "inspect_candidate",
    description:
      "Inspect one candidate: metrics, score breakdown, datasets, assumptions, limitations.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        candidateId: { type: "string" },
        scenarioId: { type: "string" },
      },
      required: ["projectId", "candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "list_datasets",
    description: "List datasets with version, freshness, coverage, and limitations.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    layer: "answer",
    name: "compare_scenarios",
    description: "Compare scenarios using consistent calculated metrics (capacity, transit, scores).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioIds: {
          type: "array",
          items: { type: "string" },
          description: "At least two scenario ids",
        },
      },
      required: ["projectId", "scenarioIds"],
      additionalProperties: false,
    },
  },
  // —— Action tools ——
  {
    layer: "action",
    name: "start_planning_project",
    description:
      "Create a planning project from a natural-language objective and open its analysis plan.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name" },
        objectiveText: { type: "string", description: "Natural-language planning question" },
        geographyLabel: { type: "string", description: "Optional geography label" },
      },
      required: ["name", "objectiveText"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_planning_objective",
    description: "Update the active objective from natural language; regenerates the analysis plan.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        objectiveText: { type: "string" },
      },
      required: ["projectId", "objectiveText"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_transit_threshold",
    description: "Set transit proximity threshold in meters (marks results stale).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
        meters: { type: "number", description: "Distance threshold in meters", minimum: 1 },
      },
      required: ["projectId", "scenarioId", "meters"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_priority_weights",
    description:
      "Set ranking weights (e.g. transit, capacity, flood_resilience). Values are normalized.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
        weights: {
          type: "object",
          description: "Map of criterion key → weight",
          additionalProperties: { type: "number" },
        },
      },
      required: ["projectId", "scenarioId", "weights"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "run_analysis",
    description: "Run spatial analysis for a scenario; returns summary and candidate count.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
      },
      required: ["projectId", "scenarioId"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "create_scenario_branch",
    description: "Duplicate a scenario so edits do not mutate the parent.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        fromScenarioId: { type: "string", description: "Source scenario to duplicate" },
      },
      required: ["projectId", "name"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "select_candidate",
    description: "Select a candidate; syncs map highlight and detail panels.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        candidateId: { type: "string" },
      },
      required: ["projectId", "candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "exclude_map_area",
    description: "Add a human/agent geographic exclusion polygon; marks results stale.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
        label: { type: "string" },
        coordinates: {
          type: "array",
          description: "Polygon ring as [lng,lat] pairs (min 3)",
          items: { type: "array", items: { type: "number" } },
        },
      },
      required: ["projectId", "scenarioId", "label", "coordinates"],
      additionalProperties: false,
    },
  },
  // —— Sensitive tools ——
  {
    layer: "sensitive",
    name: "reject_candidate",
    description:
      "Record a planner rejection of a candidate with reason. Requires user confirmation.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
        candidateId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["projectId", "scenarioId", "candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "prefer_scenario",
    description: "Select the planner's preferred scenario among alternatives. Confirms with user.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["projectId", "scenarioId"],
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "approve_scenario",
    description:
      "Approve a scenario as a formal planning decision. Always confirms with the human planner.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioId: { type: "string" },
        reason: { type: "string", description: "Optional decision rationale" },
      },
      required: ["projectId", "scenarioId"],
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "generate_report",
    description: "Generate a planning report from scenarios. Confirms before creating the document.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        scenarioIds: { type: "array", items: { type: "string" } },
        title: { type: "string" },
      },
      required: ["projectId", "scenarioIds"],
      additionalProperties: false,
    },
  },
];

function toolFromMeta(
  name: string,
  execute: WebMcpToolDefinition["execute"]
): WebMcpToolDefinition {
  const meta = PLANNING_TOOL_META.find((t) => t.name === name);
  if (!meta) throw new Error(`Unknown WebMCP tool meta: ${name}`);
  return {
    name: meta.name,
    description: meta.description,
    inputSchema: meta.inputSchema,
    annotations: meta.annotations,
    execute,
  };
}

export async function registerPlanningWebMcpTools(options?: {
  projectId?: string | null;
}): Promise<WebMcpRegistration> {
  const ctx = getModelContext();
  const controller = new AbortController();
  if (!ctx) {
    return { abort: () => undefined, available: false, toolCount: 0 };
  }

  const tools: WebMcpToolDefinition[] = [
    toolFromMeta("get_workspace", async (input) => {
      const ws = (await api(`/api/projects/${input.projectId}`)) as Parameters<
        typeof activeContext
      >[0];
      const { scenario, result } = activeContext(ws);
      return ok({
        projectId: ws.project.id,
        name: ws.project.name,
        resumeNote: ws.project.resumeNote,
        scenarioId: scenario?.id,
        scenarioName: scenario?.name,
        objective: scenario?.objective,
        constraints: scenario?.constraints.filter((c) => c.enabled).map((c) => c.label),
        weights: scenario?.weights,
        decisionStatus: scenario?.decisionStatus,
        analysisSummary: result?.summary ?? null,
        stale: result?.stale ?? false,
      });
    }),
    toolFromMeta("get_analysis_plan", async (input) => {
      const ws = (await api(`/api/projects/${input.projectId}`)) as Parameters<
        typeof activeContext
      >[0];
      const scenario =
        ws.scenarios.find((s) => s.id === input.scenarioId) ?? activeContext(ws).scenario;
      return ok({
        scenarioId: scenario?.id,
        steps: scenario?.analysisPlan?.steps ?? [],
        requirements: scenario?.objective.parsedRequirements ?? [],
      });
    }),
    toolFromMeta("list_candidates", async (input) => {
      const ws = (await api(`/api/projects/${input.projectId}`)) as Parameters<
        typeof activeContext
      >[0];
      const scenario =
        ws.scenarios.find((s) => s.id === input.scenarioId) ?? activeContext(ws).scenario;
      const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
      const limit = Number(input.limit ?? 10);
      return ok({
        stale: result?.stale ?? false,
        summary: result?.summary,
        candidates: (result?.candidates ?? []).slice(0, limit).map((c) => ({
          id: c.id,
          label: c.label,
          rank: c.rank,
          score: c.score,
          status: c.status,
        })),
      });
    }),
    toolFromMeta("inspect_candidate", async (input) => {
      const ws = (await api(`/api/projects/${input.projectId}`)) as Parameters<
        typeof activeContext
      >[0];
      const scenario =
        ws.scenarios.find((s) => s.id === input.scenarioId) ?? activeContext(ws).scenario;
      const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
      const candidate = result?.candidates.find((c) => c.id === input.candidateId);
      if (!candidate) throw new Error("Candidate not found");
      return ok({
        id: candidate.id,
        label: candidate.label,
        score: candidate.score,
        rank: candidate.rank,
        status: candidate.status,
        metrics: candidate.metrics,
        provenance: candidate.provenance,
        classification: "copilot_recommendation_unless_planner_decision",
      });
    }),
    toolFromMeta("list_datasets", async () => ok(await api("/api/datasets"))),
    toolFromMeta("compare_scenarios", async (input) => {
      const data = await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "compare_scenarios",
          scenarioIds: input.scenarioIds,
        }),
      });
      return ok(data);
    }),
    toolFromMeta("start_planning_project", async (input) => {
      const data = (await api("/api/projects", {
        method: "POST",
        body: JSON.stringify(input),
      })) as {
        project: { id: string; name: string; activeScenarioId?: string };
        scenarios: Array<{ id: string; objective: { intent: string } }>;
      };
      return ok({
        projectId: data.project.id,
        scenarioId: data.project.activeScenarioId,
        intent: data.scenarios[0]?.objective.intent,
        next: "Review get_analysis_plan then run_analysis",
      });
    }),
    toolFromMeta("set_planning_objective", async (input) => {
      const data = (await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_objective",
          objectiveText: input.objectiveText,
        }),
      })) as Parameters<typeof activeContext>[0];
      const { scenario } = activeContext(data);
      return ok({
        intent: scenario?.objective.intent,
        requirements: scenario?.objective.parsedRequirements,
        note: "Results marked stale if prior analysis existed",
      });
    }),
    toolFromMeta("set_transit_threshold", async (input) => {
      const meters = Number(input.meters);
      const full = (await api(`/api/projects/${input.projectId}`)) as {
        scenarios: Array<{
          id: string;
          constraints: Array<Record<string, unknown>>;
        }>;
      };
      const scenario = full.scenarios.find((s) => s.id === input.scenarioId);
      if (!scenario) throw new Error("Scenario not found");
      const constraints = scenario.constraints.map((c) =>
        c.operator === "within_distance"
          ? { ...c, value: meters, label: `Within ${meters}m of transit` }
          : c
      );
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_constraints",
          scenarioId: input.scenarioId,
          constraints,
        }),
      });
      return ok({ meters, note: "Criteria changed — recalculate with run_analysis" });
    }),
    toolFromMeta("set_priority_weights", async (input) => {
      const full = (await api(`/api/projects/${input.projectId}`)) as {
        scenarios: Array<{
          id: string;
          weights: Array<{ id: string; key: string; label: string; weight: number }>;
        }>;
      };
      const sc = full.scenarios.find((s) => s.id === input.scenarioId);
      if (!sc) throw new Error("Scenario not found");
      const wmap = input.weights as Record<string, number>;
      const weights = sc.weights.map((w) => ({
        ...w,
        weight: wmap[w.key] ?? w.weight,
      }));
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_weights",
          scenarioId: input.scenarioId,
          weights,
        }),
      });
      return ok({ weights, note: "Weights updated — run_analysis to refresh ranking" });
    }),
    toolFromMeta("run_analysis", async (input) => {
      const data = (await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "run_analysis",
          scenarioId: input.scenarioId,
        }),
      })) as Parameters<typeof activeContext>[0];
      const scenario = data.scenarios.find((s) => s.id === input.scenarioId);
      const result = data.analysisResults.find((r) => r.id === scenario?.latestResultId);
      return ok({
        summary: result?.summary,
        candidateCount: result?.candidates.length ?? 0,
        top: result?.candidates[0]
          ? {
              id: result.candidates[0].id,
              label: result.candidates[0].label,
              score: result.candidates[0].score,
            }
          : null,
        limitations: result?.limitations ?? [],
      });
    }),
    toolFromMeta("create_scenario_branch", async (input) => {
      const data = (await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "create_scenario",
          name: input.name,
          fromScenarioId: input.fromScenarioId,
        }),
      })) as { project: { activeScenarioId?: string } };
      return ok({
        activeScenarioId: data.project.activeScenarioId,
        name: input.name,
      });
    }),
    toolFromMeta("select_candidate", async (input) => {
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "select_candidate",
          candidateId: input.candidateId,
          featureIds: [input.candidateId],
        }),
      });
      return ok({ selected: input.candidateId });
    }),
    toolFromMeta("exclude_map_area", async (input) => {
      const ring = input.coordinates as number[][];
      if (!Array.isArray(ring) || ring.length < 3) {
        throw new Error("coordinates require at least 3 [lng,lat] pairs");
      }
      const closed =
        ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]
          ? [...ring, ring[0]]
          : ring;
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "add_geo_selection",
          scenarioId: input.scenarioId,
          selection: {
            type: "exclusion",
            label: input.label,
            geometry: { type: "Polygon", coordinates: [closed] },
            createdBy: "agent",
          },
        }),
      });
      return ok({
        excluded: input.label,
        note: "Results stale — call run_analysis",
      });
    }),
    toolFromMeta("reject_candidate", async (input, client) => {
      const confirmed = await confirmSensitive(
        client,
        `Reject candidate ${input.candidateId}?${
          input.reason ? `\nReason: ${input.reason}` : ""
        }\n\nThis is recorded as a planner decision.`
      );
      if (!confirmed) throw new Error("Rejection cancelled by planner");
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "record_decision",
          scenarioId: input.scenarioId,
          type: "reject_candidate",
          subjectId: input.candidateId,
          reason: input.reason ?? "Rejected by planner",
        }),
      });
      return ok({ rejected: input.candidateId, kind: "planner_decision" });
    }),
    toolFromMeta("prefer_scenario", async (input, client) => {
      const confirmed = await confirmSensitive(
        client,
        `Prefer scenario ${input.scenarioId} as the planner's selection?`
      );
      if (!confirmed) throw new Error("Preference cancelled by planner");
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "record_decision",
          scenarioId: input.scenarioId,
          type: "prefer_scenario",
          reason: input.reason,
        }),
      });
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "activate_scenario",
          scenarioId: input.scenarioId,
        }),
      });
      return ok({ preferredScenarioId: input.scenarioId, kind: "planner_decision" });
    }),
    toolFromMeta("approve_scenario", async (input, client) => {
      const confirmed = await confirmSensitive(
        client,
        `Approve scenario ${input.scenarioId} as a formal planning decision?\n\nThis does not make the AI recommendation authoritative — it records your human decision.`
      );
      if (!confirmed) throw new Error("Approval cancelled by planner");
      await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "record_decision",
          scenarioId: input.scenarioId,
          type: "approve_scenario",
          reason: input.reason,
        }),
      });
      return ok({ approvedScenarioId: input.scenarioId, kind: "planner_decision" });
    }),
    toolFromMeta("generate_report", async (input, client) => {
      const confirmed = await confirmSensitive(
        client,
        `Generate a planning report for ${
          Array.isArray(input.scenarioIds) ? (input.scenarioIds as string[]).length : 0
        } scenario(s)?`
      );
      if (!confirmed) throw new Error("Report generation cancelled by planner");
      const data = await api(`/api/projects/${input.projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "generate_report",
          scenarioIds: input.scenarioIds,
          title: input.title,
        }),
      });
      return ok({
        reportId: (data as { reportId?: string }).reportId,
        note: "Report distinguishes source data, calculated results, AI recommendations, and planner decisions",
      });
    }),
  ];

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
