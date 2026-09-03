/**
 * Server-side WebMCP tool execution — same domain operations as browser tools.
 */
import * as services from "@/lib/domain/services";

import {
  pendingPlannerResult,
  requiresPlannerConfirmation,
} from "@/lib/domain/human-gated-tools";
import {
  assertCompareScenarioIds,
  assertExclusionLabel,
  assertObjectiveTextAllowed,
  assessObjectiveConstraintImpact,
  assertPriorityWeights,
  assertProposalAction,
  assertTransitThresholdMeters,
  validatePolygonRing,
} from "@/lib/domain/webmcp-validation";
import {
  mergeToolContext,
  resolveProjectId,
  resolveScenarioId,
  type ToolExecutionContext,
} from "@/lib/webmcp/tool-context";
import { getToolMeta, PLANNING_TOOL_META } from "./tool-definitions";
import type { ToolErrorPayload } from "@/lib/domain/tool-errors";
import { ToolError } from "@/lib/domain/tool-errors";
import { parseMapCenter } from "@/lib/domain/map-center";
import { resolveObjectiveTextWithGeography } from "@/lib/domain/objective-geography";
import { resolvePlanningToolAlias } from "./tool-aliases";
import { getPageToolBudgetMs, PAGE_TOOL_POLL_MS, sleep } from "@/lib/webmcp/page-tool-budget";

function isKnownPlanningToolName(name: string): boolean {
  const resolved = resolvePlanningToolAlias(name);
  return resolved === "list_projects" || Boolean(getToolMeta(resolved));
}

type WorkspaceLike = NonNullable<Awaited<ReturnType<typeof services.getWorkspace>>>;

function activeContext(ws: WorkspaceLike) {
  const scenario =
    ws.scenarios.find((s) => s.id === ws.project.activeScenarioId) ?? ws.scenarios[0];
  const result = ws.analysisResults.find((r) => r.id === scenario?.latestResultId);
  return { scenario, result };
}

const ANALYSIS_POLL_MS = PAGE_TOOL_POLL_MS;
const ANALYSIS_POLL_TIMEOUT_MS = 120_000;

const ANALYSIS_IN_PROGRESS_PAYLOAD = {
  pollTools: ["get_workspace", "list_candidates"] as const,
};

async function waitForAnalysisCompletion(projectId: string, scenarioId: string) {
  const started = Date.now();
  while (Date.now() - started < ANALYSIS_POLL_TIMEOUT_MS) {
    const status = await services.getAnalysisRunStatus(projectId, scenarioId);
    if (status.status === "completed") return status;
    if (status.status === "failed") {
      throw new ToolError("ANALYSIS_FAILED", status.error ?? "Analysis failed", "scenarioId");
    }
    if (status.status === "none" || status.status === "not_found") {
      break;
    }
    await sleep(ANALYSIS_POLL_MS);
  }
  throw new ToolError(
    "ANALYSIS_TIMEOUT",
    "Analysis did not finish in time — retry run_analysis",
    "scenarioId"
  );
}

async function waitForAnalysisWithinBudget(
  projectId: string,
  scenarioId: string,
  runPromise: Promise<unknown>,
  budgetMs: number = getPageToolBudgetMs(),
  expectedJobId?: string
) {
  const deadline = Date.now() + budgetMs;
  let runSettled = false;
  void runPromise.finally(() => {
    runSettled = true;
  });
  while (Date.now() < deadline) {
    const status = await services.getAnalysisRunStatus(projectId, scenarioId);
    if (status.status === "completed") {
      if (
        expectedJobId &&
        "resultJobId" in status &&
        status.resultJobId !== expectedJobId
      ) {
        await sleep(ANALYSIS_POLL_MS);
        continue;
      }
      if (!runSettled && status.stale) {
        await sleep(ANALYSIS_POLL_MS);
        continue;
      }
      if ((status.candidateCount ?? 0) < 1) {
        throw new ToolError(
          "ANALYSIS_EMPTY",
          "Analysis completed but returned no candidates",
          "scenarioId"
        );
      }
      return status;
    }
    if (status.status === "failed") {
      throw new ToolError("ANALYSIS_FAILED", status.error ?? "Analysis failed", "scenarioId");
    }
    if (status.status === "running") {
      await sleep(ANALYSIS_POLL_MS);
      continue;
    }
    await sleep(ANALYSIS_POLL_MS);
  }

  const latest = await services.getAnalysisRunStatus(projectId, scenarioId);
  if (latest.status === "completed") {
    if (
      expectedJobId &&
      "resultJobId" in latest &&
      latest.resultJobId !== expectedJobId
    ) {
      void runPromise.catch(() => undefined);
      return {
        status: "running" as const,
        jobId: expectedJobId,
        currentStep: "Analysis in progress",
        message:
          "Analysis still running — poll get_workspace or list_candidates until candidates appear, then retry run_analysis if needed.",
        pollTools: [...ANALYSIS_IN_PROGRESS_PAYLOAD.pollTools],
      };
    }
    if ((latest.candidateCount ?? 0) < 1) {
      throw new ToolError(
        "ANALYSIS_EMPTY",
        "Analysis completed but returned no candidates",
        "scenarioId"
      );
    }
    return latest;
  }

  void runPromise.catch(() => undefined);
  if (latest.status === "running") {
    return {
      status: "running" as const,
      jobId: latest.jobId,
      progress: latest.progress,
      currentStep: latest.currentStep,
      message:
        "Analysis still running — poll get_workspace or list_candidates until candidates appear, then retry run_analysis if needed.",
      pollTools: [...ANALYSIS_IN_PROGRESS_PAYLOAD.pollTools],
    };
  }

  throw new ToolError("ANALYSIS_FAILED", "Analysis did not start", "scenarioId");
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
  rawInput: Record<string, unknown>,
  context?: ToolExecutionContext
): Promise<unknown> {
  const input = mergeToolContext(rawInput, context);
  const toolName = resolvePlanningToolAlias(name);
  if (FORBIDDEN.has(toolName) || /sql|eval|exec|dom|click|selector/i.test(toolName)) {
    throw new ToolError(
      "FORBIDDEN",
      `Tool "${name}" is not permitted. Use semantic planning tools only.`
    );
  }

  if (!isKnownPlanningToolName(name)) {
    throw new ToolError("UNKNOWN_TOOL", `Unknown tool: ${name}`);
  }

  switch (toolName) {
    case "list_projects": {
      const projects = await services.listProjects();
      return {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          geographyLabel: project.geographyLabel,
          activeScenarioId: project.activeScenarioId,
          activeScenarioName: project.activeScenarioName,
          updatedAt: project.updatedAt,
        })),
        count: projects.length,
      };
    }
    case "get_workspace": {
      const projectId = resolveProjectId(input, context);
      await services.requireProject(projectId);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const { scenario, result } = activeContext(ws);
      const runStatus = scenario
        ? await services.getAnalysisRunStatus(ws.project.id, scenario.id)
        : { status: "none" as const };
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
        analysisRunStatus: runStatus.status,
        analysisError:
          runStatus.status === "failed" ? (runStatus.error ?? "Analysis failed") : null,
        stale: result?.stale ?? false,
        pendingProposals: ws.proposals.length,
      };
    }
    case "get_analysis_plan": {
      const projectId = resolveProjectId(input, context);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const scenario = ws.scenarios.find((s) => s.id === scenarioId) ?? activeContext(ws).scenario;
      return {
        scenarioId: scenario?.id,
        steps: scenario?.analysisPlan?.steps ?? [],
        requirements: scenario?.objective.parsedRequirements ?? [],
      };
    }
    case "list_candidates": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const limit = Number(input.limit ?? 10);
      const offset = Number(input.offset ?? 0);
      const page = await services.listCandidatesPage(projectId, scenarioId, limit, offset);
      if (!page) {
        throw new ToolError(
          "NO_ANALYSIS",
          "No analysis results for this scenario — run_analysis first",
          "scenarioId"
        );
      }
      return page;
    }
    case "list_shortlist": {
      const projectId = resolveProjectId(input, context);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const scenario = ws.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
      const result = ws.analysisResults.find((r) => r.id === scenario.latestResultId);
      const entries = services.getShortlistForScenario(scenario, result);
      const ids = entries.map((entry) => entry.candidateId);
      return {
        count: entries.length,
        candidateIds: ids,
        message:
          entries.length > 0
            ? `Shortlist has ${entries.length} site(s): ${ids.join(", ")}`
            : "Shortlist is empty (0 sites).",
        shortlist: entries.map((entry) => ({
          candidateId: entry.candidateId,
          label: entry.label,
          rank: entry.candidate?.rank,
          score: entry.candidate?.score,
          pinnedAt: entry.pinnedAt,
          reason: entry.reason,
          note: entry.note,
          missing: entry.missing ?? false,
        })),
      };
    }
    case "inspect_candidate": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const candidateId = String(input.candidateId ?? "");
      const candidate = await services.findCandidateForInspection(
        projectId,
        scenarioId,
        candidateId
      );
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
        resolveProjectId(input, context),
        assertCompareScenarioIds(input.scenarioIds)
      );
    case "verify_operation":
      return services.verifyOperation(
        resolveProjectId(input, context),
        input.proposalId as string | undefined
      );
    case "start_planning_project": {
      const objectiveText = resolveObjectiveTextWithGeography(
        String(input.objectiveText ?? ""),
        typeof input.geographyLabel === "string" ? input.geographyLabel : undefined
      );
      const ws = await services.createProject({
        name: input.name as string,
        objectiveText,
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
      const projectId = resolveProjectId(input, context);
      const objectiveText = assertObjectiveTextAllowed(input.objectiveText);
      await services.requireProject(projectId);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const { scenario } = activeContext(ws);
      if (!scenario) throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
      const { droppedLabels } = assessObjectiveConstraintImpact(
        scenario,
        objectiveText,
        ws.project.geographyLabel
      );
      if (droppedLabels.length > 0 && input.confirmConstraintChange !== true) {
        throw new ToolError(
          "CONSTRAINT_CHANGE",
          `New objective would remove enabled constraints: ${droppedLabels.join(", ")}. Pass confirmConstraintChange:true after planner review.`,
          "objectiveText"
        );
      }
      const updated = await services.updateObjective(projectId, objectiveText);
      const active = activeContext(updated!);
      return {
        intent: active.scenario?.objective.intent,
        requirements: active.scenario?.objective.parsedRequirements,
        note: "Results marked stale if prior analysis existed",
        criteriaStale: true,
        droppedConstraints: droppedLabels.length ? droppedLabels : undefined,
      };
    }
    case "set_transit_threshold": {
      const meters = assertTransitThresholdMeters(input.meters);
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      await services.requireProject(projectId);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const scenario = ws.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
      const constraints = scenario.constraints.map((c) =>
        c.operator === "within_distance"
          ? { ...c, value: meters, label: `Within ${meters}m of transit` }
          : c
      );
      await services.updateConstraints(projectId, scenarioId, constraints);
      return {
        meters,
        note: "Results stale — recalculate with run_analysis",
        criteriaStale: true,
      };
    }
    case "set_priority_weights": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const ws = await services.getWorkspace(projectId);
      if (!ws) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
      const sc = ws.scenarios.find((s) => s.id === scenarioId);
      if (!sc) throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
      const weights = assertPriorityWeights(sc, input.weights);
      await services.updateWeights(projectId, scenarioId, weights);
      return { weights, note: "Weights updated — run_analysis to refresh ranking", criteriaStale: true };
    }
    case "run_analysis": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      await services.requireProject(projectId);
      await services.reconcileStaleRunningAnalysisJobs(projectId, scenarioId);

      const inFlight = await services.getAnalysisRunStatus(projectId, scenarioId);
      if (inFlight.status === "running") {
        return waitForAnalysisWithinBudget(
          projectId,
          scenarioId,
          Promise.resolve(),
          getPageToolBudgetMs(),
          inFlight.jobId
        );
      }

      await services.runAnalysis(projectId, scenarioId);
      const started = await services.getAnalysisRunStatus(projectId, scenarioId);
      const expectedJobId =
        started.status === "running" ? started.jobId : undefined;

      try {
        return await waitForAnalysisWithinBudget(
          projectId,
          scenarioId,
          Promise.resolve(),
          getPageToolBudgetMs(),
          expectedJobId
        );
      } catch (err) {
        const recovery = await services.getAnalysisRunStatus(projectId, scenarioId);
        if (
          recovery.status === "completed" &&
          (!expectedJobId ||
            !("resultJobId" in recovery) ||
            recovery.resultJobId === expectedJobId)
        ) {
          return { ...recovery, recovered: true };
        }
        if (recovery.status === "running") {
          return {
            status: "running" as const,
            jobId: recovery.jobId,
            progress: recovery.progress,
            currentStep: recovery.currentStep,
            message:
              "Analysis still running — poll get_workspace or list_candidates until candidates appear.",
            pollTools: [...ANALYSIS_IN_PROGRESS_PAYLOAD.pollTools],
          };
        }
        throw err;
      }
    }
    case "create_scenario_branch": {
      const projectId = resolveProjectId(input, context);
      const name = String(input.name ?? "").trim();
      if (!name) {
        throw new ToolError("MISSING_FIELD", "name is required", "name");
      }
      const ws = await services.createScenario(
        projectId,
        name,
        input.fromScenarioId as string | undefined
      );
      const scenario = ws?.scenarios.find((s) => s.id === ws.project.activeScenarioId);
      const createdScenario = ws?.scenarios.find((s) => s.name === name);
      const floodWeighted = /\bflood[- ]?weighted\b/i.test(name);
      const weightsSummary = createdScenario?.weights
        .map((weight) => `${weight.label} ${Math.round(weight.weight * 100)}%`)
        .join(", ");
      const viewingName = scenario?.name ?? "active scenario";
      return {
        activeScenarioId: ws?.project.activeScenarioId,
        createdScenarioId: createdScenario?.id,
        name,
        viewingScenarioName: viewingName,
        floodWeighted,
        weightsSummary,
        note: floodWeighted
          ? `Scenario duplicated with flood-weighted priorities (${weightsSummary}) — analysis results and decision status were not copied.`
          : "Scenario duplicated — analysis results and decision status were not copied.",
        message: `Created scenario branch "${name}". Still viewing "${viewingName}" — switch scenarios in the header to configure the branch, then run analysis.${
          floodWeighted
            ? ` Weights shifted toward flood resilience (${weightsSummary}).`
            : ""
        }`,
      };
    }
    case "select_candidate": {
      const projectId = resolveProjectId(input, context);
      const candidateId = String(input.candidateId ?? "").trim();
      if (!candidateId) {
        throw new ToolError("MISSING_FIELD", "candidateId is required", "candidateId");
      }
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      await services.selectCandidate(projectId, candidateId, undefined, scenarioId);
      return { selected: candidateId };
    }
    case "add_to_shortlist": {
      const projectId = resolveProjectId(input, context);
      const candidateId = String(input.candidateId ?? "").trim();
      if (!candidateId) {
        throw new ToolError("MISSING_FIELD", "candidateId is required", "candidateId");
      }
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      await services.requireProject(projectId);
      const pinned = await services.addToShortlist(projectId, scenarioId, candidateId, {
        reason: input.reason as string | undefined,
        note: input.note as string | undefined,
      });
      return {
        candidateId: pinned.candidateId,
        shortlistCount: pinned.shortlistCount,
        note: `Pinned to shortlist (${pinned.shortlistCount} site${pinned.shortlistCount === 1 ? "" : "s"})`,
      };
    }
    case "remove_from_shortlist": {
      const projectId = resolveProjectId(input, context);
      const candidateId = String(input.candidateId ?? "").trim();
      if (!candidateId) {
        throw new ToolError("MISSING_FIELD", "candidateId is required", "candidateId");
      }
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      await services.requireProject(projectId);
      const removed = await services.removeFromShortlist(projectId, scenarioId, candidateId);
      return {
        candidateId: removed.candidateId,
        shortlistCount: removed.shortlistCount,
        note: `Removed from shortlist (${removed.shortlistCount} site${removed.shortlistCount === 1 ? "" : "s"} remaining)`,
      };
    }
    case "exclude_features": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const rawIds = input.featureIds;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        throw new ToolError("MISSING_FIELD", "featureIds is required", "featureIds");
      }
      const featureIds = rawIds.map((id) => String(id).trim()).filter(Boolean);
      if (featureIds.length === 0) {
        throw new ToolError("MISSING_FIELD", "featureIds is required", "featureIds");
      }
      const label =
        typeof input.label === "string" && input.label.trim()
          ? input.label.trim()
          : `Exclude ${featureIds.length} feature${featureIds.length === 1 ? "" : "s"}`;
      await services.requireProject(projectId);
      await services.excludeFeatures(projectId, scenarioId, featureIds, label);
      return {
        excluded: label,
        featureIds,
        note: "Features excluded — recalculate.",
        criteriaStale: true,
      };
    }
    case "exclude_map_area": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
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
      const projectId = resolveProjectId(input, context);
      const [lng, lat] = parseMapCenter(input.center);
      const zoom = input.zoom == null ? undefined : Number(input.zoom);
      if (zoom != null && (!Number.isFinite(zoom) || zoom < 1 || zoom > 20)) {
        throw new ToolError("INVALID_INPUT", "zoom must be between 1 and 20", "zoom");
      }
      const ws = await services.setMapView(projectId, { center: [lng, lat], zoom });
      return {
        center: ws.center,
        zoom: ws.zoom,
        note: "Map viewport updated",
      };
    }
    case "remove_map_area": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      await services.removeGeographicSelection(
        projectId,
        scenarioId,
        input.selectionId as string
      );
      return { removed: input.selectionId, note: "Results stale — call run_analysis", criteriaStale: true };
    }
    case "update_map_area": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
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
        projectId,
        scenarioId,
        input.selectionId as string,
        patch
      );
      return { updated: input.selectionId, note: "Results stale — call run_analysis", criteriaStale: true };
    }
    case "stage_proposal": {
      const action = String(input.action ?? "");
      const payload = (input.payload ?? {}) as Record<string, unknown>;
      assertProposalAction(action, payload);
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      return services.stageProposal({
        projectId,
        scenarioId,
        title: String(input.title ?? ""),
        description: String(input.description ?? ""),
        action,
        payload,
        createdBy: "agent",
      });
    }
    case "reject_candidate": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const gatedInput = { ...input, projectId, scenarioId };
      if (requiresPlannerConfirmation("reject_candidate", gatedInput)) {
        return pendingPlannerResult("reject_candidate", gatedInput);
      }
      await services.requireProject(projectId);
      await services.recordDecision({
        projectId,
        scenarioId,
        type: "reject_candidate",
        subjectId: input.candidateId as string,
        reason: (input.reason as string) ?? "Rejected by planner",
      });
      return { rejected: input.candidateId, kind: "planner_decision" };
    }
    case "prefer_scenario": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const gatedInput = { ...input, projectId, scenarioId };
      if (requiresPlannerConfirmation("prefer_scenario", gatedInput)) {
        return pendingPlannerResult("prefer_scenario", gatedInput);
      }
      await services.requireProject(projectId);
      await services.recordDecision({
        projectId,
        scenarioId,
        type: "prefer_scenario",
        reason: input.reason as string | undefined,
      });
      await services.setActiveScenario(projectId, scenarioId);
      return { preferredScenarioId: scenarioId, kind: "planner_decision" };
    }
    case "approve_scenario": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const gatedInput = { ...input, projectId, scenarioId };
      if (requiresPlannerConfirmation("approve_scenario", gatedInput)) {
        return pendingPlannerResult("approve_scenario", gatedInput);
      }
      await services.requireProject(projectId);
      await services.recordDecision({
        projectId,
        scenarioId,
        type: "approve_scenario",
        reason: input.reason as string | undefined,
      });
      return { approvedScenarioId: scenarioId, kind: "planner_decision" };
    }
    case "approve_proposal": {
      const projectId = resolveProjectId(input, context);
      if (requiresPlannerConfirmation("approve_proposal", input)) {
        const ws = await services.getWorkspace(projectId);
        const proposal = ws?.proposals.find((p) => p.id === input.proposalId);
        return pendingPlannerResult("approve_proposal", { ...input, projectId }, { title: proposal?.title });
      }
      await services.requireProject(projectId);
      return services.approveProposal(projectId, input.proposalId as string);
    }
    case "generate_report": {
      const projectId = resolveProjectId(input, context);
      const scenarioId = await resolveScenarioId(projectId, input, services.getWorkspace);
      const scenarioIds = Array.isArray(input.scenarioIds)
        ? (input.scenarioIds as unknown[]).map((id) => String(id))
        : [scenarioId];
      const gatedInput = { ...input, projectId, scenarioIds };
      if (requiresPlannerConfirmation("generate_report", gatedInput)) {
        return pendingPlannerResult("generate_report", gatedInput, {
          title: typeof input.title === "string" ? input.title : undefined,
        });
      }
      await services.requireProject(projectId);
      const data = await services.generateReport(
        projectId,
        scenarioIds,
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
  rawInput: Record<string, unknown>,
  context?: ToolExecutionContext
): ToolErrorPayload | null {
  const toolName = resolvePlanningToolAlias(name);
  if (toolName === "list_projects") return null;
  const input = mergeToolContext(rawInput, context);
  const meta = getToolMeta(toolName);
  if (!meta) {
    return { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` };
  }
  const required = meta.inputSchema.required ?? [];
  const toolsWithoutProject = new Set(["start_planning_project", "list_datasets", "list_projects"]);
  for (const key of required) {
    if (key === "projectId" && toolsWithoutProject.has(toolName)) continue;
    if (input[key] === undefined || input[key] === null) {
      if (key === "projectId" && context?.projectId) continue;
      if (key === "scenarioId" && context?.scenarioId) continue;
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
