/**
 * Server-side WebMCP tool execution — same domain operations as browser tools.
 */
import * as services from "@/lib/domain/services";
import { getToolMeta, PLANNING_TOOL_META } from "./tool-definitions";

type WorkspaceLike = NonNullable<Awaited<ReturnType<typeof services.getWorkspace>>>;

function activeContext(ws: WorkspaceLike) {
  const scenario =
    ws.scenarios.find((s) => s.id === ws.project.activeScenarioId) ?? ws.scenarios[0];
  const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
  return { scenario, result };
}

const FORBIDDEN = new Set([
  "executeSQL",
  "executeJavascript",
  "executeCode",
  "clickButton",
  "clickAtCoordinates",
  "findElement",
  "querySelector",
  "eval",
]);

export async function executePlanningTool(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  if (FORBIDDEN.has(name) || /sql|eval|exec|dom|click|selector/i.test(name)) {
    throw new Error(`Tool "${name}" is not permitted. Use semantic planning tools only.`);
  }

  if (!getToolMeta(name)) {
    throw new Error(`Unknown tool: ${name}`);
  }

  switch (name) {
    case "get_workspace": {
      const ws = await services.getWorkspace(input.projectId as string);
      if (!ws) throw new Error("Project not found");
      const { scenario, result } = activeContext(ws);
      return {
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
        pendingProposals: ws.proposals.length,
      };
    }
    case "get_analysis_plan": {
      const ws = await services.getWorkspace(input.projectId as string);
      if (!ws) throw new Error("Project not found");
      const scenario =
        ws.scenarios.find((s) => s.id === input.scenarioId) ?? activeContext(ws).scenario;
      return {
        scenarioId: scenario?.id,
        steps: scenario?.analysisPlan?.steps ?? [],
        requirements: scenario?.objective.parsedRequirements ?? [],
      };
    }
    case "list_candidates": {
      const ws = await services.getWorkspace(input.projectId as string);
      if (!ws) throw new Error("Project not found");
      const scenario =
        ws.scenarios.find((s) => s.id === input.scenarioId) ?? activeContext(ws).scenario;
      const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
      const limit = Number(input.limit ?? 10);
      return {
        stale: result?.stale ?? false,
        summary: result?.summary,
        candidates: (result?.candidates ?? []).slice(0, limit).map((c) => ({
          id: c.id,
          label: c.label,
          rank: c.rank,
          score: c.score,
          status: c.status,
        })),
      };
    }
    case "inspect_candidate": {
      const ws = await services.getWorkspace(input.projectId as string);
      if (!ws) throw new Error("Project not found");
      const scenario =
        ws.scenarios.find((s) => s.id === input.scenarioId) ?? activeContext(ws).scenario;
      const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
      const candidate = result?.candidates.find((c) => c.id === input.candidateId);
      if (!candidate) throw new Error("Candidate not found");
      return {
        id: candidate.id,
        label: candidate.label,
        score: candidate.score,
        rank: candidate.rank,
        status: candidate.status,
        metrics: candidate.metrics,
        provenance: candidate.provenance,
        classification: "copilot_recommendation_unless_planner_decision",
      };
    }
    case "list_datasets":
      return services.listDatasets();
    case "compare_scenarios":
      return services.compareScenarios(
        input.projectId as string,
        input.scenarioIds as string[]
      );
    case "verify_operation":
      return services.verifyOperation(
        input.projectId as string,
        input.proposalId as string | undefined
      );
    case "start_planning_project": {
      const ws = await services.createProject({
        name: input.name as string,
        objectiveText: input.objectiveText as string,
        geographyLabel: input.geographyLabel as string | undefined,
      });
      return {
        projectId: ws.project.id,
        scenarioId: ws.project.activeScenarioId,
        intent: ws.scenarios[0]?.objective.intent,
        next: "Review get_analysis_plan then run_analysis",
      };
    }
    case "set_planning_objective": {
      const ws = await services.updateObjective(
        input.projectId as string,
        input.objectiveText as string
      );
      const { scenario } = activeContext(ws!);
      return {
        intent: scenario?.objective.intent,
        requirements: scenario?.objective.parsedRequirements,
        note: "Results marked stale if prior analysis existed",
      };
    }
    case "set_transit_threshold": {
      const meters = Number(input.meters);
      const ws = await services.getWorkspace(input.projectId as string);
      if (!ws) throw new Error("Project not found");
      const scenario = ws.scenarios.find((s) => s.id === input.scenarioId);
      if (!scenario) throw new Error("Scenario not found");
      const constraints = scenario.constraints.map((c) =>
        c.operator === "within_distance"
          ? { ...c, value: meters, label: `Within ${meters}m of transit` }
          : c
      );
      await services.updateConstraints(
        input.projectId as string,
        input.scenarioId as string,
        constraints
      );
      return { meters, note: "Criteria changed — recalculate with run_analysis" };
    }
    case "set_priority_weights": {
      const ws = await services.getWorkspace(input.projectId as string);
      if (!ws) throw new Error("Project not found");
      const sc = ws.scenarios.find((s) => s.id === input.scenarioId);
      if (!sc) throw new Error("Scenario not found");
      const wmap = input.weights as Record<string, number>;
      const weights = sc.weights.map((w) => ({
        ...w,
        weight: wmap[w.key] ?? w.weight,
      }));
      await services.updateWeights(
        input.projectId as string,
        input.scenarioId as string,
        weights
      );
      return { weights, note: "Weights updated — run_analysis to refresh ranking" };
    }
    case "run_analysis": {
      const ws = await services.runAnalysis(
        input.projectId as string,
        input.scenarioId as string
      );
      if (!ws) throw new Error("Analysis failed");
      const scenario = ws.scenarios.find((s) => s.id === input.scenarioId);
      const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
      const failedJob = ws.analysisJobs.find(
        (j) => j.scenarioId === input.scenarioId && j.status === "failed"
      );
      if (failedJob) {
        return {
          status: "failed",
          error: failedJob.error,
          summary: null,
          candidateCount: 0,
        };
      }
      return {
        status: "completed",
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
        stale: result?.stale ?? false,
      };
    }
    case "create_scenario_branch": {
      const ws = await services.createScenario(
        input.projectId as string,
        input.name as string,
        input.fromScenarioId as string | undefined
      );
      return {
        activeScenarioId: ws?.project.activeScenarioId,
        name: input.name,
      };
    }
    case "select_candidate":
      await services.selectCandidate(
        input.projectId as string,
        input.candidateId as string,
        [input.candidateId as string]
      );
      return { selected: input.candidateId };
    case "exclude_map_area": {
      const ring = input.coordinates as number[][];
      if (!Array.isArray(ring) || ring.length < 3) {
        throw new Error("coordinates require at least 3 [lng,lat] pairs");
      }
      const closed =
        ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]
          ? [...ring, ring[0]]
          : ring;
      await services.addGeographicSelection(
        input.projectId as string,
        input.scenarioId as string,
        {
          type: "exclusion",
          label: input.label as string,
          geometry: { type: "Polygon", coordinates: [closed] },
          createdBy: "agent",
        }
      );
      return { excluded: input.label, note: "Results stale — call run_analysis" };
    }
    case "remove_map_area": {
      await services.removeGeographicSelection(
        input.projectId as string,
        input.scenarioId as string,
        input.selectionId as string
      );
      return { removed: input.selectionId, note: "Results stale — call run_analysis" };
    }
    case "update_map_area": {
      const patch: {
        label?: string;
        geometry?: GeoJSON.Polygon;
      } = {};
      if (input.label != null) patch.label = String(input.label);
      if (input.coordinates) {
        const ring = input.coordinates as number[][];
        if (!Array.isArray(ring) || ring.length < 3) {
          throw new Error("coordinates require at least 3 [lng,lat] pairs");
        }
        const closed =
          ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]
            ? [...ring, ring[0]]
            : ring;
        patch.geometry = { type: "Polygon", coordinates: [closed] };
      }
      await services.updateGeographicSelection(
        input.projectId as string,
        input.scenarioId as string,
        input.selectionId as string,
        patch
      );
      return { updated: input.selectionId, note: "Results stale — call run_analysis" };
    }
    case "stage_proposal":
      return services.stageProposal({
        projectId: input.projectId as string,
        scenarioId: input.scenarioId as string,
        title: input.title as string,
        description: input.description as string,
        action: input.action as string,
        payload: input.payload as Record<string, unknown>,
        createdBy: "agent",
      });
    case "reject_candidate":
      await services.recordDecision({
        projectId: input.projectId as string,
        scenarioId: input.scenarioId as string,
        type: "reject_candidate",
        subjectId: input.candidateId as string,
        reason: (input.reason as string) ?? "Rejected by planner",
      });
      return { rejected: input.candidateId, kind: "planner_decision" };
    case "prefer_scenario":
      await services.recordDecision({
        projectId: input.projectId as string,
        scenarioId: input.scenarioId as string,
        type: "prefer_scenario",
        reason: input.reason as string | undefined,
      });
      await services.setActiveScenario(
        input.projectId as string,
        input.scenarioId as string
      );
      return { preferredScenarioId: input.scenarioId, kind: "planner_decision" };
    case "approve_scenario":
      await services.recordDecision({
        projectId: input.projectId as string,
        scenarioId: input.scenarioId as string,
        type: "approve_scenario",
        reason: input.reason as string | undefined,
      });
      return { approvedScenarioId: input.scenarioId, kind: "planner_decision" };
    case "approve_proposal":
      return services.approveProposal(
        input.projectId as string,
        input.proposalId as string
      );
    case "generate_report": {
      const data = await services.generateReport(
        input.projectId as string,
        input.scenarioIds as string[],
        input.title as string | undefined
      );
      return {
        reportId: data.reportId,
        note: "Report distinguishes source data, calculated results, AI recommendations, and planner decisions",
      };
    }
    default:
      throw new Error(`Unhandled tool: ${name}`);
  }
}

/** Validate tool input against minimal required fields from schema */
export function validateToolInput(
  name: string,
  input: Record<string, unknown>
): string | null {
  const meta = getToolMeta(name);
  if (!meta) return `Unknown tool: ${name}`;
  const required = meta.inputSchema.required ?? [];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null) {
      return `Missing required field: ${key}`;
    }
  }
  return null;
}

export function listToolsForCatalog() {
  return PLANNING_TOOL_META.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
    layer: t.layer,
  }));
}
