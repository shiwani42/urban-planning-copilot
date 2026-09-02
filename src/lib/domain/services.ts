import { nanoid } from "nanoid";
import {
  assessObjectiveQuality,
  buildAnalysisPlan,
  hashConfig,
  normalizeWeights,
  parseObjective,
  sha256Receipt,
} from "./objective";
import {
  canRecordScenarioDecision,
  getLatestCompletedResult,
  getLatestFreshResult,
  topRankedCandidate,
} from "./decision";
import { formatReportDateTime } from "../format";
import { runSpatialAnalysis, compareScenarioMetrics, buildComparisonInsights } from "./spatial";
import { getStore, updateStore } from "./store";
import { STUDY_BOUNDS } from "./seed";
import type {
  ActivityEvent,
  AnalysisJob,
  AnalysisResult,
  AppStore,
  ConfirmationRequest,
  Constraint,
  CriterionWeight,
  GeographicSelection,
  HumanDecision,
  MapState,
  Project,
  Report,
  Scenario,
  StagedProposal,
  WorkspaceSnapshot,
} from "./types";

function now() {
  return new Date().toISOString();
}

function defaultMapState(datasets: AppStore["datasets"]): MapState {
  return {
    viewport: {
      center: [
        (STUDY_BOUNDS.west + STUDY_BOUNDS.east) / 2,
        (STUDY_BOUNDS.south + STUDY_BOUNDS.north) / 2,
      ],
      zoom: 13,
      bounds: STUDY_BOUNDS,
    },
    layers: datasets.map((d) => ({
      datasetId: d.id,
      visible: ["parcels", "transit", "flood", "population", "schools"].includes(d.kind),
    })),
    selectedFeatureIds: [],
    highlightFeatureIds: [],
    drawingMode: "none",
  };
}

function logActivity(
  store: AppStore,
  event: Omit<ActivityEvent, "id" | "timestamp"> & { timestamp?: string }
): ActivityEvent {
  const full: ActivityEvent = {
    id: nanoid(),
    timestamp: event.timestamp ?? now(),
    ...event,
  };
  store.activities.unshift(full);
  return full;
}

function datasetNameMap(store: AppStore): Record<string, string> {
  const map: Record<string, string> = {};
  for (const d of store.datasets) {
    map[d.kind] = d.name;
  }
  return map;
}

function layersForScenario(
  store: AppStore,
  scenario: Scenario
): Record<string, GeoJSON.FeatureCollection> {
  const layers: Record<string, GeoJSON.FeatureCollection> = {};
  for (const d of store.datasets) {
    if (!d.enabled) continue;
    if (scenario.enabledDatasetIds.length && !scenario.enabledDatasetIds.includes(d.id)) {
      continue;
    }
    const fc = store.featuresByDataset[d.id];
    if (fc) layers[d.kind] = fc;
  }
  return layers;
}

function datasetIdsByKind(store: AppStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of store.datasets) out[d.kind] = d.id;
  return out;
}

function configHashFor(scenario: Scenario): string {
  return hashConfig({
    objective: scenario.objective,
    constraints: scenario.constraints,
    weights: scenario.weights,
    assumptions: scenario.assumptions,
    selections: scenario.geographicSelections,
    enabledDatasetIds: scenario.enabledDatasetIds,
  });
}

function markResultsStale(store: AppStore, scenarioId: string, reason: string) {
  for (const r of store.analysisResults) {
    if (r.scenarioId === scenarioId && r.status === "completed" && !r.stale) {
      r.stale = true;
      r.staleReason = reason;
      r.status = "stale";
    }
  }
  invalidateScenarioDecision(store, scenarioId, reason);
}

function invalidateScenarioDecision(store: AppStore, scenarioId: string, reason: string) {
  const scenario = store.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) return;
  if (
    scenario.decisionStatus === "approved" ||
    scenario.decisionStatus === "changes_requested"
  ) {
    scenario.decisionStale = true;
    scenario.decisionStaleReason = reason;
    if (scenario.decisionStatus === "approved") {
      scenario.decisionStatus = "pending";
    }
  }
}

export async function listProjects() {
  const store = await getStore();
  return store.projects
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWorkspace(projectId: string): Promise<WorkspaceSnapshot | null> {
  const store = await getStore();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return {
    project,
    scenarios: store.scenarios.filter((s) => s.projectId === projectId),
    decisions: store.decisions.filter((d) => d.projectId === projectId),
    activities: store.activities.filter((a) => a.projectId === projectId).slice(0, 200),
    confirmations: store.confirmations.filter((c) => c.projectId === projectId),
    proposals: store.proposals.filter((p) => p.projectId === projectId && p.status === "pending"),
    analysisJobs: store.analysisJobs.filter((j) =>
      store.scenarios.some((s) => s.id === j.scenarioId && s.projectId === projectId)
    ),
    analysisResults: store.analysisResults.filter((r) =>
      store.scenarios.some((s) => s.id === r.scenarioId && s.projectId === projectId)
    ),
    reports: store.reports.filter((r) => r.projectId === projectId),
    datasets: store.datasets,
  };
}

export async function createProject(input: {
  name: string;
  objectiveText: string;
  geographyLabel?: string;
  mode?: "explore" | "planning";
}): Promise<WorkspaceSnapshot> {
  const quality = assessObjectiveQuality(input.objectiveText);
  if (!quality.interpretable) {
    throw new Error(quality.warning ?? "Planning objective is not interpretable.");
  }
  let projectId = "";
  await updateStore((store) => {
    const geographyLabel = input.geographyLabel ?? "Study area";
    const parsed = parseObjective(input.objectiveText, geographyLabel);
    const project: Project = {
      id: nanoid(),
      name: input.name,
      createdAt: now(),
      updatedAt: now(),
      geographyLabel,
      mapState: defaultMapState(store.datasets),
      mode: input.mode ?? "planning",
      resumeNote: "New project — review the analysis plan to continue.",
    };
    const scenario: Scenario = {
      id: nanoid(),
      projectId: project.id,
      name: "Baseline",
      status: "draft",
      objective: parsed.objective,
      constraints: parsed.constraints,
      weights: parsed.weights,
      assumptions: parsed.assumptions,
      geographicSelections: [],
      enabledDatasetIds: store.datasets.filter((d) => d.enabled).map((d) => d.id),
      decisionStatus: "none",
      createdAt: now(),
      updatedAt: now(),
      annotations: [],
    };
    scenario.analysisPlan = buildAnalysisPlan(
      scenario.objective,
      scenario.constraints,
      datasetNameMap(store)
    );
    project.activeScenarioId = scenario.id;
    store.projects.push(project);
    store.scenarios.push(scenario);
    logActivity(store, {
      projectId: project.id,
      scenarioId: scenario.id,
      actor: "human",
      category: "objective",
      action: "create_project",
      summary: `Created project "${project.name}"`,
      inputs: { objective: input.objectiveText },
    });
    logActivity(store, {
      projectId: project.id,
      scenarioId: scenario.id,
      actor: "agent",
      category: "agent",
      action: "propose_plan",
      summary: "Proposed structured analysis plan from planning objective",
      outputs: {
        intent: scenario.objective.intent,
        steps: scenario.analysisPlan.steps.length,
        requirements: scenario.objective.parsedRequirements,
      },
    });
    projectId = project.id;
  });
  const ws = await getWorkspace(projectId);
  if (!ws) throw new Error("Failed to create project");
  return ws;
}

export async function updateObjective(projectId: string, text: string) {
  await updateStore((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    const scenario = store.scenarios.find((s) => s.id === project?.activeScenarioId);
    if (!project || !scenario) throw new Error("Project/scenario not found");
    const parsed = parseObjective(text, project.geographyLabel);
    scenario.objective = parsed.objective;
    scenario.constraints = parsed.constraints;
    scenario.weights = parsed.weights;
    scenario.assumptions = parsed.assumptions;
    scenario.analysisPlan = buildAnalysisPlan(
      scenario.objective,
      scenario.constraints,
      datasetNameMap(store)
    );
    scenario.updatedAt = now();
    scenario.status = "draft";
    project.updatedAt = now();
    project.resumeNote = "Objective updated — review plan and recalculate.";
    markResultsStale(store, scenario.id, "Planning objective changed");
    logActivity(store, {
      projectId,
      scenarioId: scenario.id,
      actor: "human",
      category: "objective",
      action: "update_objective",
      summary: "Updated planning objective",
      inputs: { text },
      outputs: { intent: parsed.objective.intent, requirements: parsed.objective.parsedRequirements },
    });
  });
  return getWorkspace(projectId);
}

export async function updateConstraints(
  projectId: string,
  scenarioId: string,
  constraints: Constraint[]
) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    scenario.constraints = constraints;
    scenario.analysisPlan = buildAnalysisPlan(
      scenario.objective,
      scenario.constraints,
      datasetNameMap(store)
    );
    scenario.updatedAt = now();
    scenario.status = "draft";
    markResultsStale(store, scenario.id, "Constraints changed");
    touchProject(store, projectId, "Constraints changed — results may be stale.");
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "constraint",
      action: "update_constraints",
      summary: "Updated planning constraints",
      inputs: { constraints: constraints.map((c) => c.label) },
    });
  });
  return getWorkspace(projectId);
}

export async function updateWeights(
  projectId: string,
  scenarioId: string,
  weights: CriterionWeight[]
) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    scenario.weights = normalizeWeights(weights);
    scenario.updatedAt = now();
    scenario.status = "draft";
    markResultsStale(store, scenario.id, "Priority weights changed");
    touchProject(store, projectId, "Weights changed — recalculate to refresh ranking.");
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "constraint",
      action: "update_weights",
      summary: "Updated criterion weights",
      inputs: {
        weights: Object.fromEntries(scenario.weights.map((w) => [w.key, w.weight])),
      },
    });
  });
  return getWorkspace(projectId);
}

export async function updateAssumptions(
  projectId: string,
  scenarioId: string,
  assumptions: Scenario["assumptions"]
) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    scenario.assumptions = assumptions;
    scenario.updatedAt = now();
    scenario.status = "draft";
    markResultsStale(store, scenario.id, "Assumptions changed");
    touchProject(store, projectId, "Assumptions changed — recalculate recommended.");
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "constraint",
      action: "update_assumptions",
      summary: "Updated analysis assumptions",
    });
  });
  return getWorkspace(projectId);
}

export async function addGeographicSelection(
  projectId: string,
  scenarioId: string,
  selection: Omit<GeographicSelection, "id" | "createdAt">
) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    const full: GeographicSelection = {
      ...selection,
      id: nanoid(),
      createdAt: now(),
    };
    scenario.geographicSelections.push(full);
    scenario.updatedAt = now();
    scenario.status = "draft";
    markResultsStale(store, scenario.id, "Geographic selection changed");
    touchProject(store, projectId, "Geographic exclusion/inclusion applied.");
    logActivity(store, {
      projectId,
      scenarioId,
      actor: selection.createdBy === "human" ? "human" : "agent",
      category: "map",
      action: "geographic_selection",
      summary: `${selection.type} area "${selection.label}" added`,
      inputs: { type: selection.type, label: selection.label },
    });
  });
  return getWorkspace(projectId);
}

export async function excludeFeatures(
  projectId: string,
  scenarioId: string,
  featureIds: string[],
  label?: string
) {
  const constraint: Constraint = {
    id: nanoid(),
    label: label ?? `Exclude ${featureIds.length} features`,
    operator: "excluded_ids",
    value: featureIds,
    hard: true,
    enabled: true,
  };
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    scenario.constraints.push(constraint);
    scenario.updatedAt = now();
    markResultsStale(store, scenario.id, "Features excluded by planner");
    touchProject(store, projectId, "Features excluded — recalculate.");
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "map",
      action: "exclude_features",
      summary: constraint.label,
      inputs: { featureIds },
    });
  });
  return getWorkspace(projectId);
}

export async function updateMapState(projectId: string, mapState: Partial<MapState>) {
  await updateStore((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    project.mapState = { ...project.mapState, ...mapState };
    project.updatedAt = now();
  });
  return getWorkspace(projectId);
}

export async function selectCandidate(
  projectId: string,
  candidateId: string | undefined,
  featureIds?: string[]
) {
  await updateStore((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    project.mapState.selectedCandidateId = candidateId;
    project.mapState.selectedFeatureIds = featureIds ?? (candidateId ? [candidateId] : []);
    project.mapState.highlightFeatureIds = featureIds ?? (candidateId ? [candidateId] : []);
    project.updatedAt = now();
  });
  return getWorkspace(projectId);
}

function requireScenario(store: AppStore, projectId: string, scenarioId: string): Scenario {
  const scenario = store.scenarios.find((s) => s.id === scenarioId && s.projectId === projectId);
  if (!scenario) throw new Error("Scenario not found");
  return scenario;
}

function touchProject(store: AppStore, projectId: string, resumeNote?: string) {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return;
  project.updatedAt = now();
  if (resumeNote) project.resumeNote = resumeNote;
}

export async function runAnalysis(projectId: string, scenarioId: string) {
  const store = await getStore();
  const scenario = requireScenario(store, projectId, scenarioId);
  const missing: string[] = [];
  const layers = layersForScenario(store, scenario);
  if (!layers.parcels) missing.push("parcels");
  for (const c of scenario.constraints.filter((x) => x.enabled)) {
    if (c.datasetKind === "transit" && !layers.transit) missing.push("transit");
    if (c.datasetKind === "flood" && !layers.flood) missing.push("flood");
  }

  if (missing.length) {
    await updateStore((s) => {
      const job: AnalysisJob = {
        id: nanoid(),
        scenarioId,
        status: "failed",
        planId: scenario.analysisPlan?.id ?? "none",
        startedAt: now(),
        completedAt: now(),
        progress: 0,
        activityIds: [],
        configHash: configHashFor(scenario),
        error: `Missing required datasets: ${Array.from(new Set(missing)).join(", ")}`,
      };
      s.analysisJobs.push(job);
      logActivity(s, {
        projectId,
        scenarioId,
        actor: "agent",
        category: "analysis",
        action: "analysis_failed",
        summary: job.error!,
        outputs: { missing },
      });
      touchProject(s, projectId, "Analysis failed — missing data.");
    });
    return getWorkspace(projectId);
  }

  const jobId = nanoid();
  const configHash = configHashFor(scenario);

  await updateStore((s) => {
    const sc = requireScenario(s, projectId, scenarioId);
    const job: AnalysisJob = {
      id: jobId,
      scenarioId,
      status: "running",
      planId: sc.analysisPlan?.id ?? "none",
      startedAt: now(),
      progress: 5,
      currentStep: "Starting analysis",
      activityIds: [],
      configHash,
    };
    s.analysisJobs.push(job);
    if (sc.analysisPlan) {
      sc.analysisPlan.steps = sc.analysisPlan.steps.map((step) => ({
        ...step,
        status: "pending",
      }));
    }
    logActivity(s, {
      projectId,
      scenarioId,
      actor: "agent",
      category: "analysis",
      action: "analysis_started",
      summary: "Started spatial analysis",
      inputs: { configHash },
    });
    touchProject(s, projectId, "Analysis running…");
  });

  // Execute synchronously but expose stepwise activity (deterministic engine)
  const live = await getStore();
  const sc = requireScenario(live, projectId, scenarioId);
  const rejected = new Set(
    live.decisions
      .filter((d) => d.scenarioId === scenarioId && d.type === "reject_candidate")
      .map((d) => d.subjectId!)
      .filter(Boolean)
  );

  // Re-check config hash for interruption semantics
  const hashNow = configHashFor(sc);
  const output = runSpatialAnalysis({
    objective: sc.objective,
    constraints: sc.constraints,
    weights: sc.weights,
    assumptions: sc.assumptions,
    selections: sc.geographicSelections,
    layers: layersForScenario(live, sc),
    datasetIds: datasetIdsByKind(live),
    rejectedCandidateFeatureIds: rejected,
    externalLimitations: live.datasets
      .filter((d) => d.incompleteCoverage || d.stale)
      .flatMap((d) =>
        d.limitations.map((l) =>
          d.incompleteCoverage ? `${d.name}: ${l}` : `${d.name}: ${l}`
        )
      ),
  });

  await updateStore((s) => {
    const job = s.analysisJobs.find((j) => j.id === jobId);
    const scenarioLive = requireScenario(s, projectId, scenarioId);
    const currentHash = configHashFor(scenarioLive);

    if (!job) return;

    // Record step activities from engine logs
    for (const step of output.stepLogs) {
      const ev = logActivity(s, {
        projectId,
        scenarioId,
        actor: "agent",
        category: "analysis",
        action: step.step,
        summary: step.detail,
        outputs: { count: step.count },
      });
      job.activityIds.push(ev.id);
      job.progress = Math.min(95, job.progress + 12);
      job.currentStep = step.detail;
      if (scenarioLive.analysisPlan) {
        const planStep = scenarioLive.analysisPlan.steps.find(
          (ps) =>
            ps.operation === step.step ||
            step.detail.toLowerCase().includes(ps.label.toLowerCase().slice(0, 12))
        );
        if (planStep) planStep.status = "completed";
      }
    }

    if (currentHash !== job.configHash) {
      job.status = "cancelled";
      job.completedAt = now();
      job.error = "Planning criteria changed during analysis. Results need recalculation.";
      logActivity(s, {
        projectId,
        scenarioId,
        actor: "system",
        category: "analysis",
        action: "analysis_stale_cancelled",
        summary: job.error,
      });
      touchProject(s, projectId, "Planning criteria changed. Current results need recalculation.");
      return;
    }

    const result: AnalysisResult = {
      id: nanoid(),
      jobId: job.id,
      scenarioId,
      status: "completed",
      createdAt: now(),
      completedAt: now(),
      candidates: output.candidates,
      aggregateMetrics: output.aggregateMetrics,
      summary: output.summary,
      stepLogs: output.stepLogs,
      limitations: [
        ...output.limitations,
        ...s.datasets
          .filter((d) => d.stale || d.incompleteCoverage)
          .map((d) => `${d.name}: ${d.limitations.join("; ")}`),
      ],
      stale: false,
      configHash: job.configHash,
    };

    // Apply rejection status onto candidates
    for (const c of result.candidates) {
      const rejectedDecision = s.decisions.find(
        (d) =>
          d.scenarioId === scenarioId &&
          d.type === "reject_candidate" &&
          (d.subjectId === c.id || c.featureIds.includes(d.subjectId ?? ""))
      );
      if (rejectedDecision) {
        c.status = "rejected";
        c.rejectionReason = rejectedDecision.reason;
      }
    }

    // Propagate analysis-level limitations onto each candidate
    for (const c of result.candidates) {
      c.provenance.limitations = [...result.limitations];
    }

    s.analysisResults.push(result);
    job.status = "completed";
    job.progress = 100;
    job.completedAt = now();
    job.currentStep = "Complete";
    scenarioLive.latestResultId = result.id;
    scenarioLive.updatedAt = now();
    if (
      scenarioLive.decisionStatus === "approved" &&
      scenarioLive.approvedAgainstResultId &&
      scenarioLive.approvedAgainstResultId !== result.id
    ) {
      scenarioLive.decisionStale = true;
      scenarioLive.decisionStaleReason = "Analysis recalculated — prior approval is stale";
      scenarioLive.decisionStatus = "pending";
    } else if (scenarioLive.approvedAgainstConfigHash) {
      const hash = configHashFor(scenarioLive);
      if (scenarioLive.approvedAgainstConfigHash !== hash) {
        scenarioLive.decisionStale = true;
        scenarioLive.decisionStaleReason = "Planning inputs changed since approval";
        scenarioLive.decisionStatus = "pending";
      }
    }
    if (scenarioLive.analysisPlan) {
      scenarioLive.analysisPlan.steps = scenarioLive.analysisPlan.steps.map((st) => ({
        ...st,
        status: "completed",
      }));
    }

    logActivity(s, {
      projectId,
      scenarioId,
      actor: "agent",
      category: "analysis",
      action: "analysis_completed",
      summary: output.summary,
      outputs: {
        candidateCount: output.candidates.length,
        topCandidate: output.candidates[0]?.label,
      },
      relatedCandidateIds: output.candidates.slice(0, 5).map((c) => c.id),
    });
    touchProject(
      s,
      projectId,
      output.candidates.length
        ? `Analysis complete — ${output.candidates.length} candidates.`
        : "No feasible candidates — consider relaxing constraints."
    );
  });

  return getWorkspace(projectId);
}

export async function createScenario(
  projectId: string,
  name: string,
  fromScenarioId?: string
) {
  await updateStore((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    const source = fromScenarioId
      ? store.scenarios.find((s) => s.id === fromScenarioId)
      : store.scenarios.find((s) => s.id === project.activeScenarioId);

    const scenario: Scenario = source
      ? {
          ...structuredClone(source),
          id: nanoid(),
          name,
          status: "draft",
          parentScenarioId: source.id,
          latestResultId: undefined,
          decisionStatus: "none",
          preferredCandidateId: undefined,
          createdAt: now(),
          updatedAt: now(),
          savedAt: undefined,
        }
      : (() => {
          const parsed = parseObjective("Explore planning options", project.geographyLabel);
          return {
            id: nanoid(),
            projectId,
            name,
            status: "draft" as const,
            objective: parsed.objective,
            constraints: parsed.constraints,
            weights: parsed.weights,
            assumptions: parsed.assumptions,
            geographicSelections: [],
            enabledDatasetIds: store.datasets.filter((d) => d.enabled).map((d) => d.id),
            decisionStatus: "none" as const,
            createdAt: now(),
            updatedAt: now(),
            annotations: [],
          };
        })();

    if (!scenario.analysisPlan) {
      scenario.analysisPlan = buildAnalysisPlan(
        scenario.objective,
        scenario.constraints,
        datasetNameMap(store)
      );
    }
    store.scenarios.push(scenario);
    project.activeScenarioId = scenario.id;
    project.updatedAt = now();
    project.resumeNote = fromScenarioId
      ? `Duplicated "${source?.name ?? "scenario"}" — run analysis on "${name}" when ready.`
      : project.resumeNote;
    logActivity(store, {
      projectId,
      scenarioId: scenario.id,
      actor: "human",
      category: "scenario",
      action: fromScenarioId ? "duplicate_scenario" : "create_scenario",
      summary: fromScenarioId
        ? `Duplicated scenario into "${name}"`
        : `Created scenario "${name}"`,
      inputs: { fromScenarioId },
    });
  });
  return getWorkspace(projectId);
}

export async function saveScenario(projectId: string, scenarioId: string) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    scenario.status = "saved";
    scenario.savedAt = now();
    scenario.updatedAt = now();
    touchProject(store, projectId, `Scenario "${scenario.name}" saved.`);
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "scenario",
      action: "save_scenario",
      summary: `Saved scenario "${scenario.name}"`,
    });
  });
  return getWorkspace(projectId);
}

export async function setActiveScenario(projectId: string, scenarioId: string) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    const project = store.projects.find((p) => p.id === projectId)!;
    project.activeScenarioId = scenarioId;
    project.updatedAt = now();
    const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
    if (result) {
      project.resumeNote = `Analysis complete — ${result.candidates.length} candidates (${scenario.name}).`;
    } else {
      project.resumeNote = `Scenario "${scenario.name}" — no analysis results yet.`;
    }
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "scenario",
      action: "activate_scenario",
      summary: "Switched active scenario",
    });
  });
  return getWorkspace(projectId);
}

export async function renameScenario(
  projectId: string,
  scenarioId: string,
  name: string,
  description?: string
) {
  const trimmed = name.trim();
  if (trimmed.length < 1) throw new Error("Scenario name is required");
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    scenario.name = trimmed;
    if (description !== undefined) {
      scenario.description = description.trim() || undefined;
    }
    scenario.updatedAt = now();
    touchProject(store, projectId, `Renamed scenario to "${trimmed}".`);
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "scenario",
      action: "rename_scenario",
      summary: `Renamed scenario to "${trimmed}"`,
    });
  });
  return getWorkspace(projectId);
}

export async function compareScenarios(projectId: string, scenarioIds: string[]) {
  const store = await getStore();
  const rows = scenarioIds.map((id) => {
    const scenario = store.scenarios.find((s) => s.id === id && s.projectId === projectId);
    const result = store.analysisResults.find((r) => r.id === scenario?.latestResultId);
    return {
      scenarioId: id,
      name: scenario?.name ?? id,
      weights: scenario?.weights,
      housingTarget:
        scenario?.objective.intent === "housing_capacity"
          ? scenario.objective.targetValue
          : undefined,
      result: result
        ? {
            candidates: result.candidates,
            aggregateMetrics: result.aggregateMetrics,
            summary: result.summary,
            limitations: result.limitations,
            stepLogs: result.stepLogs ?? [],
          }
        : null,
    };
  });
  return {
    comparison: compareScenarioMetrics(rows),
    insights: buildComparisonInsights(rows),
    scenarios: scenarioIds.map((id) => store.scenarios.find((s) => s.id === id)),
  };
}

export async function recordDecision(input: {
  projectId: string;
  scenarioId: string;
  type: HumanDecision["type"];
  subjectId?: string;
  reason?: string;
  actor?: string;
}) {
  const store = await getStore();
  const scenario = requireScenario(store, input.projectId, input.scenarioId);
  const scenarioResults = store.analysisResults.filter((r) => r.scenarioId === input.scenarioId);

  if (
    input.type === "approve_scenario" ||
    input.type === "reject_scenario" ||
    input.type === "request_changes"
  ) {
    const err = canRecordScenarioDecision(
      scenario,
      scenarioResults,
      input.type,
      input.reason
    );
    if (err) throw new Error(err);
  }

  if (input.type === "prefer_scenario" && scenario.decisionStatus === "approved" && !scenario.decisionStale) {
    throw new Error(
      "This scenario already has a recorded human approval — Copilot cannot override your decision."
    );
  }

  await updateStore((s) => {
    const scenario = requireScenario(s, input.projectId, input.scenarioId);
    const decision: HumanDecision = {
      id: nanoid(),
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      type: input.type,
      subjectId: input.subjectId,
      reason: input.reason,
      actor: input.actor ?? "Planner",
      createdAt: now(),
    };
    s.decisions.unshift(decision);

    if (input.type === "approve_scenario") {
      const result = getLatestFreshResult(scenario, s.analysisResults);
      scenario.decisionStatus = "approved";
      scenario.decisionStale = false;
      scenario.decisionStaleReason = undefined;
      scenario.approvedAgainstConfigHash = configHashFor(scenario);
      scenario.approvedAgainstResultId = result?.id;
    } else if (input.type === "reject_scenario") {
      scenario.decisionStatus = "rejected";
      scenario.decisionStale = false;
      scenario.decisionStaleReason = undefined;
      scenario.approvedAgainstConfigHash = undefined;
      scenario.approvedAgainstResultId = undefined;
    } else if (input.type === "request_changes") {
      scenario.decisionStatus = "changes_requested";
      scenario.decisionStale = true;
      scenario.decisionStaleReason = input.reason ?? "Planner requested changes";
      scenario.approvedAgainstConfigHash = undefined;
      scenario.approvedAgainstResultId = undefined;
    } else if (input.type === "prefer_scenario") {
      const project = s.projects.find((p) => p.id === input.projectId)!;
      project.activeScenarioId = input.scenarioId;
      scenario.decisionStatus = "pending";
    } else if (input.type === "reject_candidate" && input.subjectId) {
      const result = s.analysisResults.find((r) => r.id === scenario.latestResultId);
      const candidate = result?.candidates.find(
        (c) => c.id === input.subjectId || c.featureIds.includes(input.subjectId!)
      );
      if (candidate) {
        candidate.status = "rejected";
        candidate.rejectionReason = input.reason;
        if (scenario.preferredCandidateId === candidate.id) {
          scenario.preferredCandidateId = undefined;
        }
      }
    } else if (input.type === "prefer_candidate" && input.subjectId) {
      scenario.preferredCandidateId = input.subjectId;
      const result = s.analysisResults.find((r) => r.id === scenario.latestResultId);
      if (result) {
        for (const c of result.candidates) {
          if (c.id === input.subjectId) c.status = "preferred";
          else if (c.status === "preferred") c.status = "eligible";
        }
      }
    }

    logActivity(s, {
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      actor: "human",
      category: "decision",
      action: input.type,
      summary: `Human decision: ${input.type}${input.reason ? ` — ${input.reason}` : ""}`,
      inputs: { subjectId: input.subjectId, reason: input.reason },
    });
    touchProject(s, input.projectId, `Decision recorded: ${input.type}`);
  });
  return getWorkspace(input.projectId);
}

export async function createConfirmation(input: {
  projectId: string;
  scenarioId: string;
  title: string;
  description: string;
  impact: Record<string, string | number>;
  proposedAction: Record<string, unknown>;
}) {
  let id = "";
  await updateStore((store) => {
    const conf: ConfirmationRequest = {
      id: nanoid(),
      ...input,
      status: "pending",
      createdAt: now(),
    };
    store.confirmations.unshift(conf);
    id = conf.id;
    logActivity(store, {
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      actor: "agent",
      category: "decision",
      action: "request_confirmation",
      summary: input.title,
      inputs: input.proposedAction,
      outputs: input.impact,
    });
  });
  return { id, workspace: await getWorkspace(input.projectId) };
}

export async function resolveConfirmation(
  projectId: string,
  confirmationId: string,
  status: "approved" | "modified" | "rejected"
) {
  await updateStore((store) => {
    const conf = store.confirmations.find(
      (c) => c.id === confirmationId && c.projectId === projectId
    );
    if (!conf) throw new Error("Confirmation not found");
    conf.status = status;
    conf.resolvedAt = now();
    logActivity(store, {
      projectId,
      scenarioId: conf.scenarioId,
      actor: "human",
      category: "decision",
      action: `confirmation_${status}`,
      summary: `${status} confirmation: ${conf.title}`,
    });
  });
  return getWorkspace(projectId);
}

export async function generateReport(projectId: string, scenarioIds: string[], title?: string) {
  const store = await getStore();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) throw new Error("Project not found");
  const scenarios = store.scenarios.filter(
    (s) => s.projectId === projectId && scenarioIds.includes(s.id)
  );

  for (const sc of scenarios) {
    const result = getLatestFreshResult(
      sc,
      store.analysisResults.filter((r) => r.scenarioId === sc.id)
    );
    if (!result) {
      throw new Error(`Scenario "${sc.name}" has no completed analysis — run analysis first.`);
    }
    if (result.stale) {
      throw new Error(
        `Scenario "${sc.name}" results are stale — recalculate before generating a report.`
      );
    }
  }

  const comparison = await compareScenarios(projectId, scenarioIds);
  const generatedAt = formatReportDateTime(now());

  const sections: Report["sections"] = [];

  for (const sc of scenarios) {
    const result = getLatestCompletedResult(
      sc,
      store.analysisResults.filter((r) => r.scenarioId === sc.id)
    )!;
    const top = topRankedCandidate(result);
    const decisions = store.decisions.filter((d) => d.scenarioId === sc.id);
    const approval = decisions.find((d) => d.type === "approve_scenario");
    const housingTarget =
      sc.objective.intent === "housing_capacity" ? sc.objective.targetValue : undefined;
    const totalCapacity = result.aggregateMetrics.find((m) => m.key === "total_capacity")?.value;
    const meetsTarget = result.aggregateMetrics.find((m) => m.key === "meets_target_count")?.value;

    sections.push({
      heading: `Planning objective — ${sc.name}`,
      kind: "calculated",
      body: sc.objective.rawText,
    });

    const decisionLines: string[] = [];
    if (approval) {
      decisionLines.push(
        `Status: Approved`,
        `Recorded: ${formatReportDateTime(approval.createdAt)}`,
        approval.reason ? `Planner rationale: ${approval.reason}` : ""
      );
      if (sc.decisionStale) {
        decisionLines.push(
          `Note: This approval is stale (${sc.decisionStaleReason ?? "inputs changed"}).`
        );
      }
    } else if (sc.decisionStatus === "changes_requested") {
      const changeReq = decisions.find((d) => d.type === "request_changes");
      decisionLines.push(
        `Status: Changes requested`,
        changeReq?.reason ? `Requested changes: ${changeReq.reason}` : ""
      );
    } else if (sc.decisionStatus === "rejected") {
      const rejection = decisions.find((d) => d.type === "reject_scenario");
      decisionLines.push(
        `Status: Rejected`,
        rejection?.reason ? `Reason: ${rejection.reason}` : ""
      );
    } else {
      decisionLines.push("Status: No human decision recorded yet.");
    }

    sections.push({
      heading: `Planner decision — ${sc.name}`,
      kind: "planner_decision",
      body: decisionLines.filter(Boolean).join("\n"),
    });

    sections.push({
      heading: `Methodology — ${sc.name}`,
      kind: "methodology",
      body: (sc.analysisPlan?.steps ?? [])
        .map((st) => `${st.order}. ${st.label}: ${st.purpose}`)
        .join("\n"),
    });

    sections.push({
      heading: `Datasets — ${sc.name}`,
      kind: "source_data",
      body: store.datasets
        .filter((d) => sc.enabledDatasetIds.includes(d.id))
        .map((d) => {
          const updated = formatReportDateTime(d.updatedAt);
          const synth = d.synthetic ? " (synthetic seed data)" : "";
          const limits =
            d.limitations.length > 0 ? ` — Limitations: ${d.limitations.join("; ")}` : "";
          return `${d.name} v${d.version} — ${d.source}; last updated ${updated}${synth}${limits}`;
        })
        .join("\n"),
    });

    sections.push({
      heading: `Assumptions — ${sc.name}`,
      kind: "calculated",
      body: sc.assumptions
        .map((a) => `${a.label}: ${a.value}${a.unit ? ` ${a.unit}` : ""} — ${a.description}`)
        .join("\n"),
    });

    sections.push({
      heading: `Constraints — ${sc.name}`,
      kind: "calculated",
      body: sc.constraints
        .filter((c) => c.enabled)
        .map((c) => `${c.label} (${c.hard ? "hard" : "soft"})`)
        .join("\n"),
    });

    const resultsBody = [
      result.summary,
      housingTarget != null && totalCapacity != null
        ? `Aggregate capacity: ${totalCapacity.toLocaleString()} homes vs ${housingTarget.toLocaleString()}-home target (${Number(meetsTarget ?? 0)} candidates meet target alone).`
        : "",
      `Top-ranked candidate: ${top?.label ?? "—"} (score ${top?.score?.toFixed(1) ?? "—"})`,
    ]
      .filter(Boolean)
      .join("\n");

    sections.push({
      heading: `Results — ${sc.name}`,
      kind: "calculated",
      body: resultsBody,
      data: result.aggregateMetrics,
    });

    if (top) {
      sections.push({
        heading: `Copilot recommendation — ${sc.name}`,
        kind: "copilot_recommendation",
        body: `Copilot ranked ${top.label} highest (score ${top.score.toFixed(1)}). This is an AI recommendation, not a planning decision.`,
      });
    }

    if (approval && top) {
      const humanOverrode =
        approval.subjectId && approval.subjectId !== top.id
          ? true
          : approval.reason?.toLowerCase().includes("baseline") ||
              approval.reason?.toLowerCase().includes("override")
            ? true
            : false;
      sections.push({
        heading: `Human vs Copilot — ${sc.name}`,
        kind: "planner_decision",
        body: humanOverrode
          ? `Planner approved scenario "${sc.name}" with rationale that may differ from Copilot's top pick (${top.label}). Human decision takes precedence.`
          : approval
            ? `Planner approved scenario "${sc.name}"${approval.reason ? `: ${approval.reason}` : ""}.`
            : "No approval recorded.",
      });
    }

    sections.push({
      heading: `Limitations — ${sc.name}`,
      kind: "limitations",
      body: (result.limitations.length
        ? result.limitations
        : ["No limitations recorded"]
      ).join("\n"),
    });
  }

  if (scenarioIds.length > 1) {
    sections.push({
      heading: "Scenario comparison",
      kind: "comparison",
      body: "Side-by-side metrics across selected scenarios. Rank scores are comparable within a scenario only.",
      data: comparison.comparison,
    });
    if (comparison.insights.length) {
      sections.push({
        heading: "Trade-off insights",
        kind: "comparison",
        body: comparison.insights.map((i) => `${i.heading}: ${i.body}`).join("\n\n"),
      });
    }
  }

  let reportId = "";
  await updateStore((s) => {
    const report: Report = {
      id: nanoid(),
      projectId,
      scenarioIds,
      title: title ?? `${project.name} — Planning Report`,
      audience: "Planning team",
      createdAt: now(),
      sections,
    };
    s.reports.unshift(report);
    reportId = report.id;
    logActivity(s, {
      projectId,
      actor: "agent",
      category: "report",
      action: "generate_report",
      summary: `Generated report "${report.title}" at ${generatedAt}`,
      outputs: { reportId, generatedAt },
    });
  });
  const ws = await getWorkspace(projectId);
  return { reportId, workspace: ws, report: (await getStore()).reports.find((r) => r.id === reportId) };
}

export async function setDatasetEnabled(datasetId: string, enabled: boolean) {
  await updateStore((store) => {
    const ds = store.datasets.find((d) => d.id === datasetId);
    if (!ds) throw new Error("Dataset not found");
    ds.enabled = enabled;
    for (const scenario of store.scenarios) {
      if (enabled && !scenario.enabledDatasetIds.includes(datasetId)) {
        // do not auto-add; caller may update scenario
      }
      if (!enabled) {
        scenario.enabledDatasetIds = scenario.enabledDatasetIds.filter((id) => id !== datasetId);
        markResultsStale(store, scenario.id, `Dataset ${ds.name} disabled`);
      }
    }
    logActivity(store, {
      projectId: store.projects[0]?.id ?? "system",
      actor: "human",
      category: "data",
      action: enabled ? "enable_dataset" : "disable_dataset",
      summary: `${enabled ? "Enabled" : "Disabled"} dataset ${ds.name}`,
      relatedDatasetIds: [datasetId],
    });
  });
}

export async function markDatasetStale(datasetId: string, stale: boolean) {
  await updateStore((store) => {
    const ds = store.datasets.find((d) => d.id === datasetId);
    if (!ds) throw new Error("Dataset not found");
    ds.stale = stale;
    if (stale) {
      ds.limitations = Array.from(
        new Set([...ds.limitations, "Marked outdated — verify before relying on recommendations"])
      );
    }
  });
}

export async function patchFeatureProperties(
  datasetId: string,
  featureId: string,
  props: Record<string, unknown>
) {
  await updateStore((store) => {
    const fc = store.featuresByDataset[datasetId];
    if (!fc) throw new Error("Dataset features not found");
    const feature = fc.features.find(
      (f) => String(f.id) === featureId || String(f.properties?.id) === featureId
    );
    if (!feature) throw new Error("Feature not found");
    feature.properties = { ...feature.properties, ...props };
    for (const scenario of store.scenarios) {
      markResultsStale(store, scenario.id, `Underlying data changed for ${featureId}`);
    }
    logActivity(store, {
      projectId: store.projects[0]?.id ?? "system",
      actor: "human",
      category: "data",
      action: "patch_feature",
      summary: `Updated feature ${featureId} properties`,
      inputs: props,
      relatedDatasetIds: [datasetId],
    });
  });
}

export async function getActivity(projectId: string, activityId: string) {
  const store = await getStore();
  return store.activities.find((a) => a.projectId === projectId && a.id === activityId) ?? null;
}

function scenarioRevision(store: AppStore, projectId: string, scenarioId: string): string {
  const scenario = store.scenarios.find((s) => s.id === scenarioId && s.projectId === projectId);
  if (!scenario) throw new Error("Scenario not found");
  return configHashFor(scenario);
}

export async function stageProposal(input: {
  projectId: string;
  scenarioId: string;
  title: string;
  description: string;
  action: string;
  payload: Record<string, unknown>;
  createdBy?: "agent" | "human";
}) {
  let proposalId = "";
  await updateStore((store) => {
    const scenario = requireScenario(store, input.projectId, input.scenarioId);
    const proposal: StagedProposal = {
      id: nanoid(),
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      title: input.title,
      description: input.description,
      action: input.action,
      payload: input.payload,
      baseRevision: configHashFor(scenario),
      status: "pending",
      createdAt: now(),
      createdBy: input.createdBy ?? "agent",
    };
    store.proposals.unshift(proposal);
    proposalId = proposal.id;
    logActivity(store, {
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      actor: input.createdBy === "human" ? "human" : "agent",
      category: "decision",
      action: "stage_proposal",
      summary: `Staged proposal: ${input.title}`,
      inputs: { action: input.action, baseRevision: proposal.baseRevision },
    });
    touchProject(store, input.projectId, `Proposal pending review: ${input.title}`);
  });
  return { proposalId, workspace: await getWorkspace(input.projectId) };
}

async function applyProposalAction(
  projectId: string,
  scenarioId: string,
  action: string,
  payload: Record<string, unknown>
) {
  switch (action) {
    case "update_weights":
      await updateWeights(projectId, scenarioId, payload.weights as CriterionWeight[]);
      break;
    case "update_constraints":
      await updateConstraints(projectId, scenarioId, payload.constraints as Constraint[]);
      break;
    case "set_transit_threshold": {
      const meters = Number(payload.meters);
      const ws = await getWorkspace(projectId);
      const sc = ws?.scenarios.find((s) => s.id === scenarioId);
      if (!sc) throw new Error("Scenario not found");
      const constraints = sc.constraints.map((c) =>
        c.operator === "within_distance"
          ? { ...c, value: meters, label: `Within ${meters}m of transit` }
          : c
      );
      await updateConstraints(projectId, scenarioId, constraints);
      break;
    }
    case "approve_scenario":
      await recordDecision({
        projectId,
        scenarioId,
        type: "approve_scenario",
        reason: payload.reason as string | undefined,
      });
      break;
    default:
      throw new Error(`Unsupported proposal action: ${action}`);
  }
}

export async function approveProposal(projectId: string, proposalId: string) {
  const store = await getStore();
  const proposal = store.proposals.find(
    (p) => p.id === proposalId && p.projectId === projectId
  );
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending") {
    throw new Error(`Proposal is ${proposal.status}, not pending`);
  }

  const currentRevision = scenarioRevision(store, projectId, proposal.scenarioId);
  if (currentRevision !== proposal.baseRevision) {
    await updateStore((s) => {
      const p = s.proposals.find((x) => x.id === proposalId);
      if (p) {
        p.status = "stale";
        p.resolvedAt = now();
      }
      logActivity(s, {
        projectId,
        scenarioId: proposal.scenarioId,
        actor: "system",
        category: "decision",
        action: "proposal_stale",
        summary: "Proposal rejected — planning criteria changed since staging",
        inputs: { expected: proposal.baseRevision, actual: currentRevision },
      });
    });
    throw new Error(
      "Proposal is stale — planning criteria changed since it was staged. Review and re-stage."
    );
  }

  await applyProposalAction(
    projectId,
    proposal.scenarioId,
    proposal.action,
    proposal.payload
  );

  const receipt = {
    proposalId,
    projectId,
    scenarioId: proposal.scenarioId,
    action: proposal.action,
    baseRevision: proposal.baseRevision,
    approvedAt: now(),
    payload: proposal.payload,
  };
  const receiptSha256 = sha256Receipt(receipt);

  await updateStore((s) => {
    const p = s.proposals.find((x) => x.id === proposalId);
    if (p) {
      p.status = "approved";
      p.resolvedAt = now();
      p.receiptSha256 = receiptSha256;
    }
    logActivity(s, {
      projectId,
      scenarioId: proposal.scenarioId,
      actor: "human",
      category: "decision",
      action: "approve_proposal",
      summary: `Approved proposal: ${proposal.title}`,
      outputs: { receiptSha256 },
    });
    touchProject(s, projectId, `Proposal applied: ${proposal.title}`);
  });

  return {
    proposalId,
    receiptSha256,
    workspace: await getWorkspace(projectId),
  };
}

export async function rejectProposal(projectId: string, proposalId: string, reason?: string) {
  await updateStore((store) => {
    const proposal = store.proposals.find(
      (p) => p.id === proposalId && p.projectId === projectId
    );
    if (!proposal) throw new Error("Proposal not found");
    proposal.status = "rejected";
    proposal.resolvedAt = now();
    logActivity(store, {
      projectId,
      scenarioId: proposal.scenarioId,
      actor: "human",
      category: "decision",
      action: "reject_proposal",
      summary: `Rejected proposal: ${proposal.title}${reason ? ` — ${reason}` : ""}`,
    });
    touchProject(store, projectId, "Proposal rejected by planner.");
  });
  return getWorkspace(projectId);
}

export async function verifyOperation(projectId: string, proposalId?: string) {
  const store = await getStore();
  const proposal = proposalId
    ? store.proposals.find((p) => p.id === proposalId && p.projectId === projectId)
    : store.proposals.find(
        (p) => p.projectId === projectId && p.status === "approved" && p.receiptSha256
      );

  if (!proposal?.receiptSha256) {
    return {
      verified: false,
      error: "No approved operation with receipt found",
    };
  }

  const receipt = {
    proposalId: proposal.id,
    projectId: proposal.projectId,
    scenarioId: proposal.scenarioId,
    action: proposal.action,
    baseRevision: proposal.baseRevision,
    approvedAt: proposal.resolvedAt,
    payload: proposal.payload,
  };
  const computed = sha256Receipt(receipt);

  return {
    verified: computed === proposal.receiptSha256,
    receiptSha256: proposal.receiptSha256,
    computedSha256: computed,
    proposalId: proposal.id,
    action: proposal.action,
    status: proposal.status,
  };
}

export async function listDatasets() {
  const store = await getStore();
  return store.datasets;
}

/** In-memory explore investigation — does not create a persisted project. */
export async function exploreScratch(question: string) {
  const store = await getStore();
  const layers: Record<string, GeoJSON.FeatureCollection> = {};
  for (const d of store.datasets) {
    if (!d.enabled) continue;
    const fc = store.featuresByDataset[d.id];
    if (fc) layers[d.kind] = fc;
  }

  const { runExploreInvestigation } = await import("./explore");
  const result = runExploreInvestigation({
    question,
    layers,
    datasetIds: datasetIdsByKind(store),
    datasets: store.datasets,
  });

  return {
    ...result,
    layerData: {
      parcels: layers.parcels,
      transit: layers.transit,
      flood: layers.flood,
      schools: layers.schools,
      population: layers.population,
    },
    datasets: store.datasets.filter((d) => d.enabled),
  };
}

export async function getFeatures(datasetId: string) {
  const store = await getStore();
  return store.featuresByDataset[datasetId] ?? null;
}
