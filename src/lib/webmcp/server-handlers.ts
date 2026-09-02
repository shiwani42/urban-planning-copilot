/**
 * Server-side WebMCP tool execution — same domain operations as browser tools.
 */
import * as services from "@/lib/domain/services";
import {
  pendingHumanResult,
  requiresPlannerConfirmation,
} from "@/lib/domain/human-gated-tools";
import {
  assertCompareScenarioIds,
  assertExclusionLabel,
  assertNonEmptyProjectId,
  assertObjectiveTextAllowed,
  assertPriorityWeights,
  assertProposalAction,
  assertTransitThresholdMeters,
  validatePolygonRing,
} from "@/lib/domain/webmcp-validation";
import { getToolMeta, PLANNING_TOOL_META } from "./tool-definitions";
import type { ToolErrorPayload } from "@/lib/domain/tool-errors";
import { ToolError } from "@/lib/domain/tool-errors";

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
    throw new ToolError(
      "FORBIDDEN",
      `Tool "${name}" is not permitted. Use semantic planning tools only.`
    );
  }

  if (!getToolMeta(name)) {
    throw new ToolError("UNKNOWN_TOOL", `Unknown tool: ${name}`);
  }

  switch (name) {
    case "get_workspace": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      await services.requireProject(projectId);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
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
        assertNonEmptyProjectId(input.projectId),
        assertCompareScenarioIds(input.scenarioIds)
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
      const projectId = ws.project.id;
      return {
        projectId,
        scenarioId: ws.project.activeScenarioId,
        workspaceUrl: `/workspace/${projectId}`,
        intent: ws.scenarios[0]?.objective.intent,
        next: "Review get_analysis_plan then run_analysis",
      };
    }
    case "set_planning_objective": {
      const ws = await services.updateObjective(
        assertNonEmptyProjectId(input.projectId),
        assertObjectiveTextAllowed(input.objectiveText)
      );
      const { scenario } = activeContext(ws!);
      return {
        intent: scenario?.objective.intent,
        requirements: scenario?.objective.parsedRequirements,
        note: "Results marked stale if prior analysis existed",
      };
    }
    case "set_transit_threshold": {
      const meters = assertTransitThresholdMeters(input.meters);
      const projectId = assertNonEmptyProjectId(input.projectId);
      await services.requireProject(projectId);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const scenario = ws.scenarios.find((s) => s.id === input.scenarioId);
      if (!scenario) throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
      const constraints = scenario.constraints.map((c) =>
        c.operator === "within_distance"
          ? { ...c, value: meters, label: `Within ${meters}m of transit` }
          : c
      );
      await services.updateConstraints(projectId, input.scenarioId as string, constraints);
      return {
        meters,
        note: "Results stale — recalculate with run_analysis",
        criteriaStale: true,
      };
    }
    case "set_priority_weights": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const sc = ws.scenarios.find((s) => s.id === input.scenarioId);
      if (!sc) throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
      const weights = assertPriorityWeights(sc, input.weights);
      await services.updateWeights(projectId, input.scenarioId as string, weights);
      return { weights, note: "Weights updated — run_analysis to refresh ranking" };
    }
    case "run_analysis": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      const scenarioId = String(input.scenarioId ?? "").trim();
      if (!scenarioId) {
        throw new ToolError("MISSING_FIELD", "scenarioId is required", "scenarioId");
      }
      await services.requireProject(projectId);

      const inFlight = await services.getAnalysisRunStatus(projectId, scenarioId);
      if (inFlight.status === "running") {
        return {
          status: "running",
          message: "Analysis in progress — wait for completion before retrying",
          jobId: inFlight.jobId,
          progress: inFlight.progress,
          currentStep: inFlight.currentStep,
        };
      }

      try {
        await services.runAnalysis(projectId, scenarioId);
      } catch (err) {
        const recovery = await services.getAnalysisRunStatus(projectId, scenarioId);
        if (recovery.status === "completed") {
          return { ...recovery, recovered: true };
        }
        throw err;
      }

      const status = await services.getAnalysisRunStatus(projectId, scenarioId);
      if (status.status === "completed") {
        return status;
      }
      if (status.status === "failed") {
        return {
          status: "failed",
          error: status.error,
          summary: null,
          candidateCount: 0,
        };
      }
      throw new ToolError("ANALYSIS_FAILED", "Analysis did not complete", "scenarioId");
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
    case "select_candidate": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      const candidateId = String(input.candidateId ?? "").trim();
      if (!candidateId) {
        throw new ToolError("MISSING_FIELD", "candidateId is required", "candidateId");
      }
      await services.selectCandidate(projectId, candidateId, undefined, input.scenarioId as string | undefined);
      return { selected: candidateId };
    }
    case "exclude_map_area": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      const scenarioId = String(input.scenarioId ?? "").trim();
      if (!scenarioId) {
        throw new ToolError("MISSING_FIELD", "scenarioId is required", "scenarioId");
      }
      const label = assertExclusionLabel(input.label);
      const closed = validatePolygonRing(input.coordinates);
      await services.requireProject(projectId);
      const ws = await services.excludeMapArea(projectId, scenarioId, {
        label,
        geometry: { type: "Polygon", coordinates: [closed] },
        createdBy: "agent",
      });
      return {
        excluded: label,
        selectionId: ws?.scenarios
          .find((s) => s.id === scenarioId)
          ?.geographicSelections.at(-1)?.id,
        note: "Results stale — recalculate with run_analysis",
        criteriaStale: true,
      };
    }
    case "set_map_view": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      const centerInput = input.center as number[] | undefined;
      if (!Array.isArray(centerInput) || centerInput.length < 2) {
        throw new ToolError(
          "INVALID_INPUT",
          "center must be [lng, lat]",
          "center"
        );
      }
      const lng = Number(centerInput[0]);
      const lat = Number(centerInput[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        throw new ToolError("INVALID_INPUT", "center must contain finite numbers", "center");
      }
      const zoom = input.zoom == null ? undefined : Number(input.zoom);
      if (zoom != null && (!Number.isFinite(zoom) || zoom < 1 || zoom > 20)) {
        throw new ToolError("INVALID_INPUT", "zoom must be between 1 and 20", "zoom");
      }
      const ws = await services.setMapView(projectId, { center: [lng, lat], zoom });
      return {
        center: ws?.project.mapState.viewport.center,
        zoom: ws?.project.mapState.viewport.zoom,
      };
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
    case "stage_proposal": {
      const action = String(input.action ?? "");
      const payload = (input.payload ?? {}) as Record<string, unknown>;
      assertProposalAction(action, payload);
      return services.stageProposal({
        projectId: assertNonEmptyProjectId(input.projectId),
        scenarioId: String(input.scenarioId ?? ""),
        title: String(input.title ?? ""),
        description: String(input.description ?? ""),
        action,
        payload,
        createdBy: "agent",
      });
    }
    case "reject_candidate": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      if (requiresPlannerConfirmation("reject_candidate", input)) {
        return pendingHumanResult("reject_candidate", input);
      }
      await services.requireProject(projectId);
      await services.recordDecision({
        projectId,
        scenarioId: input.scenarioId as string,
        type: "reject_candidate",
        subjectId: input.candidateId as string,
        reason: (input.reason as string) ?? "Rejected by planner",
      });
      return { rejected: input.candidateId, kind: "planner_decision" };
    }
    case "prefer_scenario": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      if (requiresPlannerConfirmation("prefer_scenario", input)) {
        return pendingHumanResult("prefer_scenario", input);
      }
      await services.requireProject(projectId);
      await services.recordDecision({
        projectId,
        scenarioId: input.scenarioId as string,
        type: "prefer_scenario",
        reason: input.reason as string | undefined,
      });
      await services.setActiveScenario(projectId, input.scenarioId as string);
      return { preferredScenarioId: input.scenarioId, kind: "planner_decision" };
    }
    case "approve_scenario": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      if (requiresPlannerConfirmation("approve_scenario", input)) {
        return pendingHumanResult("approve_scenario", input);
      }
      await services.requireProject(projectId);
      await services.recordDecision({
        projectId,
        scenarioId: input.scenarioId as string,
        type: "approve_scenario",
        reason: input.reason as string | undefined,
      });
      return { approvedScenarioId: input.scenarioId, kind: "planner_decision" };
    }
    case "approve_proposal": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      if (requiresPlannerConfirmation("approve_proposal", input)) {
        const ws = await services.getWorkspace(projectId);
        const proposal = ws?.proposals.find((p) => p.id === input.proposalId);
        return pendingHumanResult("approve_proposal", input, { title: proposal?.title });
      }
      await services.requireProject(projectId);
      return services.approveProposal(projectId, input.proposalId as string);
    }
    case "generate_report": {
      const projectId = assertNonEmptyProjectId(input.projectId);
      await services.requireProject(projectId);
      const data = await services.generateReport(
        projectId,
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
): ToolErrorPayload | null {
  const meta = getToolMeta(name);
  if (!meta) {
    return { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` };
  }
  const required = meta.inputSchema.required ?? [];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null) {
      return {
        code: "MISSING_FIELD",
        field: key,
        message: `Missing required field: ${key}`,
      };
    }
    if (key === "objectiveText" && typeof input[key] === "string" && !input[key].trim()) {
      return {
        code: "INVALID_INPUT",
        field: key,
        message: "objectiveText cannot be empty",
      };
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
