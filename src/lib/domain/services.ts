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
  isStaleRunningAnalysisJob,
  staleRunningJobMessage,
} from "./analysis-jobs";
import {
  applyScoreStatsToResult,
  compactCandidateForStore,
  dedupeAnalysisResultsPerScenario,
  resultCandidateCount,
  resultScoreSpread,
} from "./analysis-candidates";
import { findCandidateInStore } from "./store-persistence";
import {
  canRecordScenarioDecision,
  getLatestCompletedResult,
  getLatestFreshResult,
  topRankedCandidate,
} from "./decision";
import { formatReportDateTime, dedupeLimitations, formatDecisionType } from "../format";
import { cloneScenarioForBranch } from "./scenario-clone";
import {
  applyFloodWeightedWeights,
  isFloodWeightedBranchName,
} from "./weights";
import {
  activeScenarioNeedsRepair,
  resolveScenarioId,
} from "./scenario-resolution";
import {
  findCandidateInResult,
  findShortlistEntry,
  featureIdsOverlap,
  remapShortlistAfterAnalysis,
  resolveShortlist,
  shortlistEntries,
  shortlistPinReason,
} from "./shortlist";
import { isHousingIntent, isAccessIntent } from "./intent";
import {
  buildComparisonInsights,
  runSpatialAnalysis,
  type ScenarioComparisonInput,
} from "./spatial";
import {
  buildCompareTableRows,
  buildHousingTargetSummaries,
  buildScenarioInputsDiff,
  comparisonResultsIdentical,
  enrichComparisonRows,
  RANK_SCORE_EXPLANATION,
  type ScenarioInputSnapshot,
} from "./compare";
import { getStore, updateStore, reloadStoreFromDisk, StorePersistError } from "./store";
import { STUDY_BOUNDS } from "./study-bounds";
import { ToolError } from "./tool-errors";
import {
  assertObjectiveTextAllowed,
  assertProposalAction,
  humanizeProposalTitle,
} from "./webmcp-validation";
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
  ProjectListItem,
  PlanningIntent,
  RecentActivityRow,
  RecentAnalysisRow,
  Report,
  Scenario,
  StagedProposal,
  WorkspaceSnapshot,
} from "./types";

function now() {
  return new Date().toISOString();
}

const analysisGateByProject = new Map<string, Promise<void>>();

async function withAnalysisGate<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = analysisGateByProject.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => gate);
  analysisGateByProject.set(projectId, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (analysisGateByProject.get(projectId) === chained) {
      analysisGateByProject.delete(projectId);
    }
  }
}

function syncMapLayers(
  mapState: MapState,
  datasets: AppStore["datasets"]
): MapState {
  const existing = new Map(mapState.layers.map((l) => [l.datasetId, l]));
  const layers = datasets.map((d) => {
    const prior = existing.get(d.id);
    if (prior) return prior;
    return {
      datasetId: d.id,
      visible: ["parcels", "transit", "flood", "population", "schools", "parks"].includes(d.kind),
    };
  });
  return { ...mapState, layers };
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
      visible: ["parcels", "transit", "flood", "population", "schools", "parks"].includes(d.kind),
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

function datasetSnapshot(store: AppStore, scenario?: Scenario) {
  const enabledIds = scenario?.enabledDatasetIds?.length
    ? new Set(scenario.enabledDatasetIds)
    : new Set(store.datasets.filter((d) => d.enabled).map((d) => d.id));
  return store.datasets
    .filter((d) => enabledIds.has(d.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      version: d.version,
      dataVintage: d.dataVintage,
      stale: Boolean(d.stale),
      enabled: d.enabled,
    }));
}

function collectDatasetLimitations(store: AppStore, scenario: Scenario): string[] {
  const enabled = new Set(scenario.enabledDatasetIds);
  const notes: string[] = [];
  for (const d of store.datasets) {
    if (!d.enabled || !enabled.has(d.id)) continue;
    for (const l of d.limitations) {
      notes.push(`${d.name}: ${l}`);
    }
    if (d.incompleteCoverage) {
      notes.push(`${d.name}: incomplete geographic coverage`);
    }
    if (d.stale) {
      notes.push(`${d.name}: marked outdated in catalog`);
    }
  }
  return dedupeLimitations(notes);
}

function scenarioLabel(store: AppStore, scenarioId?: string): string | undefined {
  if (!scenarioId) return undefined;
  return store.scenarios.find((s) => s.id === scenarioId)?.name;
}

function datasetNameMap(store: AppStore): Record<string, string> {
  const map: Record<string, string> = {};
  for (const d of store.datasets) {
    map[d.kind] = d.name;
  }
  return map;
}

function parseForStore(store: AppStore, text: string, geographyLabel: string) {
  return parseObjective(text, geographyLabel, {
    availableDatasetKinds: store.datasets.filter((d) => d.enabled).map((d) => d.kind),
  });
}

/** Re-parse stored rawText so stale intents (e.g. service_access) are corrected before analysis. */
export function reconcileScenarioObjectiveFromRawText(
  store: AppStore,
  scenario: Scenario,
  geographyLabel: string
): { intentChanged: boolean; previousIntent: PlanningIntent } {
  const rawText = scenario.objective.rawText?.trim();
  if (!rawText) {
    return { intentChanged: false, previousIntent: scenario.objective.intent };
  }
  const previousIntent = scenario.objective.intent;
  const parsed = parseForStore(store, rawText, geographyLabel);
  const intentChanged = parsed.objective.intent !== previousIntent;
  scenario.objective = parsed.objective;
  if (intentChanged) {
    scenario.constraints = parsed.constraints;
    scenario.weights = parsed.weights;
    scenario.assumptions = parsed.assumptions;
  }
  scenario.analysisPlan = buildAnalysisPlan(
    scenario.objective,
    scenario.constraints,
    datasetNameMap(store)
  );
  scenario.updatedAt = now();
  return { intentChanged, previousIntent };
}

let analysisDelayMsForTests = 0;

/** Test hook — delay spatial analysis so MCP in-progress polling can be exercised. */
export function setAnalysisDelayForTests(ms: number): void {
  analysisDelayMsForTests = Math.max(0, ms);
}

function shouldRunAnalysisSynchronously(): boolean {
  return process.env.UPC_ANALYSIS_SYNC === "1";
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

function datasetIdsUsedByAnalysisPlan(store: AppStore, scenario: Scenario): Set<string> {
  const used = new Set<string>();
  const idsByKind = datasetIdsByKind(store);
  const nameToId = new Map(store.datasets.map((d) => [d.name.toLowerCase(), d.id]));

  const addRef = (ref: string) => {
    const byName = nameToId.get(ref.toLowerCase());
    if (byName) {
      used.add(byName);
      return;
    }
    const byKind = idsByKind[ref];
    if (byKind) used.add(byKind);
  };

  const steps = scenario.analysisPlan?.steps ?? [];
  if (steps.length) {
    for (const step of steps) {
      for (const ref of step.datasets) addRef(ref);
    }
    for (const id of [...used]) {
      const ds = store.datasets.find((d) => d.id === id);
      if (!ds) continue;
      const constraint = scenario.constraints.find((c) => c.datasetKind === ds.kind);
      if (constraint && !constraint.enabled) used.delete(id);
    }
    return used;
  }

  for (const c of scenario.constraints) {
    if (!c.enabled || !c.datasetKind) continue;
    const id = idsByKind[c.datasetKind];
    if (id) used.add(id);
  }
  if (idsByKind.parcels) used.add(idsByKind.parcels);
  return used;
}

function scenarioUsesDataset(store: AppStore, scenario: Scenario, datasetId: string): boolean {
  const ds = store.datasets.find((d) => d.id === datasetId);
  if (!ds) return false;
  const disabledKinds = new Set(
    scenario.constraints
      .filter((c) => !c.enabled && c.datasetKind)
      .map((c) => c.datasetKind!)
  );
  if (disabledKinds.has(ds.kind)) return false;
  return datasetIdsUsedByAnalysisPlan(store, scenario).has(datasetId);
}

function markReportsStaleForScenario(store: AppStore, scenarioId: string, reason: string) {
  for (const report of store.reports) {
    if (report.scenarioIds.includes(scenarioId) && !report.stale) {
      report.stale = true;
      report.staleReason = reason;
    }
  }
}

export function summarizeProjectForList(
  store: AppStore,
  project: Project
): Pick<
  ProjectListItem,
  | "approvedScenarioName"
  | "activeScenarioStatus"
  | "activeScenarioNote"
  | "actionRequiredLabel"
  | "actionRequiredKind"
  | "resumeNote"
  | "shortlistCount"
> {
  const scenarios = store.scenarios.filter((s) => s.projectId === project.id);
  const approved = scenarios.find(
    (s) => s.decisionStatus === "approved" && !s.decisionStale
  );
  const active =
    scenarios.find((s) => s.id === project.activeScenarioId) ?? scenarios[0];
  const shortlistCount = active?.shortlist?.length ?? 0;
  const activeResult = active
    ? store.analysisResults.find((r) => r.id === active.latestResultId)
    : undefined;

  const approvedScenarioName = approved?.name;
  const activeScenarioStatus = active
    ? resumeNoteForScenario(active, activeResult)
    : undefined;
  const activeScenarioNote =
    active && approved && active.id !== approved.id
      ? activeScenarioStatus
      : !approved
        ? activeScenarioStatus
        : undefined;

  let actionRequiredLabel: string | undefined;
  let actionRequiredKind: ProjectListItem["actionRequiredKind"];

  const resume = project.resumeNote ?? "";
  if (resume.includes("pending") || resume.includes("Proposal")) {
    actionRequiredLabel = resume;
    actionRequiredKind = "manual";
  } else if (resume.match(/recalculate|stale/i)) {
    actionRequiredLabel = resume;
    actionRequiredKind = "data";
  } else if (
    active &&
    activeResult &&
    !activeResult.stale &&
    active.decisionStatus !== "approved" &&
    !approved &&
    (resume.includes("complete") || resume.includes("candidates"))
  ) {
    actionRequiredLabel = `Review results — ${active.name}`;
    actionRequiredKind = "ai";
  } else if (
    active &&
    activeResult?.stale &&
    active.decisionStatus !== "approved"
  ) {
    actionRequiredLabel =
      activeResult.staleReason ??
      `Recalculate analysis for ${active.name} — inputs or data changed.`;
    actionRequiredKind = "data";
  }

  const resumeNote = approvedScenarioName
    ? [
        `Approved: ${approvedScenarioName}`,
        activeScenarioStatus && active?.id !== approved?.id ? activeScenarioStatus : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    : activeScenarioStatus ?? project.resumeNote;

  return {
    approvedScenarioName,
    activeScenarioStatus,
    activeScenarioNote,
    actionRequiredLabel,
    actionRequiredKind,
    resumeNote,
    shortlistCount: shortlistCount > 0 ? shortlistCount : undefined,
  };
}

function analysisDisplayName(scenario: Scenario, result?: AnalysisResult): string {
  const step = scenario.analysisPlan?.steps.find((s) => s.status === "completed")?.label;
  if (step) return step;
  if (result?.summary) {
    const short = result.summary.split(/[.—]/)[0]?.trim();
    if (short && short.length <= 48) return short;
  }
  return "Site suitability analysis";
}

function resultStatusForRow(
  result: AnalysisResult,
  runningJobIds: Set<string>
): RecentAnalysisRow["status"] {
  if (runningJobIds.has(result.jobId)) return "running";
  if (result.status === "failed" || result.error) return "failed";
  if (result.stale || result.status === "stale") return "stale";
  return "completed";
}

function resultLabelForRow(result: AnalysisResult): string {
  if (result.status === "failed" || result.error) {
    return result.error ?? "Analysis failed";
  }
  if (result.stale) {
    return result.staleReason ?? "Results stale — recalculate";
  }
  const top = result.candidates[0];
  if (top) {
    return `${result.candidates.length} candidate${result.candidates.length === 1 ? "" : "s"}`;
  }
  const trimmed = result.summary.trim();
  if (trimmed.length <= 64) return trimmed;
  return trimmed.slice(0, 61) + "…";
}

export function listRecentAnalyses(store: AppStore, limit = 8): RecentAnalysisRow[] {
  const runningJobIds = new Set(
    store.analysisJobs.filter((j) => j.status === "running").map((j) => j.id)
  );
  const rows: RecentAnalysisRow[] = [];

  for (const job of store.analysisJobs) {
    const scenario = store.scenarios.find((s) => s.id === job.scenarioId);
    const project = scenario
      ? store.projects.find((p) => p.id === scenario.projectId)
      : undefined;
    if (!scenario || !project) continue;
    if (job.status === "running") {
      rows.push({
        id: `job-${job.id}`,
        analysisName: job.currentStep ?? "Analysis run",
        projectId: project.id,
        projectName: project.name,
        scenarioId: scenario.id,
        status: "running",
        result: "Processing…",
        timestamp: job.startedAt,
      });
    } else if (job.status === "failed") {
      const hasNewerResult = store.analysisResults.some(
        (r) =>
          r.scenarioId === job.scenarioId &&
          (r.completedAt ?? r.createdAt) >= (job.completedAt ?? job.startedAt)
      );
      if (!hasNewerResult) {
        rows.push({
          id: `job-${job.id}`,
          analysisName: "Analysis run",
          projectId: project.id,
          projectName: project.name,
          scenarioId: scenario.id,
          status: "failed",
          result: job.error ?? "Data missing",
          timestamp: job.completedAt ?? job.startedAt,
        });
      }
    }
  }

  for (const result of store.analysisResults) {
    const scenario = store.scenarios.find((s) => s.id === result.scenarioId);
    const project = scenario
      ? store.projects.find((p) => p.id === scenario.projectId)
      : undefined;
    if (!scenario || !project) continue;
    const status = resultStatusForRow(result, runningJobIds);
    if (status === "running") continue;
    rows.push({
      id: result.id,
      analysisName: analysisDisplayName(scenario, result),
      projectId: project.id,
      projectName: project.name,
      scenarioId: scenario.id,
      status,
      result: resultLabelForRow(result),
      timestamp: result.completedAt ?? result.createdAt,
    });
  }

  return rows
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

export function listRecentSystemActivity(
  store: AppStore,
  limit = 5
): RecentActivityRow[] {
  return store.activities
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      summary: a.summary,
      actor: a.actor,
      timestamp: a.timestamp,
      projectId: a.projectId,
    }));
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

function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase();
}

export function projectNameTaken(
  store: AppStore,
  name: string,
  excludeProjectId?: string
): boolean {
  const norm = normalizeProjectName(name);
  if (norm.length < 2) return false;
  return store.projects.some(
    (p) => p.id !== excludeProjectId && normalizeProjectName(p.name) === norm
  );
}

function assertProjectName(name: unknown) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Project name is required.");
  }
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new Error("Project name must be at least 2 characters.");
  }
  return trimmed;
}

export function resolveCreateObjectiveText(body: Record<string, unknown>): unknown {
  if (body.objectiveText !== undefined && body.objectiveText !== null) {
    return body.objectiveText;
  }
  if (body.objective !== undefined && body.objective !== null) {
    return body.objective;
  }
  return undefined;
}

function assertCreateObjectiveText(objectiveText: unknown) {
  if (typeof objectiveText !== "string" || !objectiveText.trim()) {
    throw new Error(
      "Planning objective is required — send objectiveText or objective with your planning question."
    );
  }
  const quality = assessObjectiveQuality(objectiveText);
  if (!quality.interpretable) {
    throw new Error(quality.warning ?? "Planning objective is not interpretable.");
  }
  return objectiveText.trim();
}

export function getWorkspaceFromStore(
  store: AppStore,
  projectId: string
): WorkspaceSnapshot | null {
  return workspaceSnapshotFromStore(store, projectId);
}

function projectListItemsFromStore(store: AppStore): ProjectListItem[] {
  return store.projects
    .filter((p) => workspaceSnapshotFromStore(store, p.id) !== null)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => {
      const summary = summarizeProjectForList(store, p);
      const scenarios = store.scenarios.filter((s) => s.projectId === p.id);
      const scenarioNames = scenarios.map((s) => s.name);
      const active =
        scenarios.find((s) => s.id === p.activeScenarioId) ?? scenarios[0];
      return {
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        lastOpenedAt: p.lastOpenedAt,
        resumeNote: summary.resumeNote,
        geographyLabel: p.geographyLabel,
        approvedScenarioName: summary.approvedScenarioName,
        activeScenarioStatus: summary.activeScenarioStatus,
        activeScenarioNote: summary.activeScenarioNote,
        activeScenarioName: active?.name,
        activeScenarioId: active?.id,
        actionRequiredLabel: summary.actionRequiredLabel,
        actionRequiredKind: summary.actionRequiredKind,
        shortlistCount: summary.shortlistCount,
        scenarioCount: scenarios.length > 1 ? scenarios.length : undefined,
        scenarioSummary:
          scenarios.length > 1 ? scenarioNames.join(" · ") : undefined,
      };
    });
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const store = await reloadStoreFromDisk();
  return projectListItemsFromStore(store);
}

export function listHomeDashboardFromStore(store: AppStore): {
  projects: ProjectListItem[];
  recentAnalyses: RecentAnalysisRow[];
  recentActivity: RecentActivityRow[];
} {
  return {
    projects: projectListItemsFromStore(store),
    recentAnalyses: listRecentAnalyses(store),
    recentActivity: listRecentSystemActivity(store),
  };
}

export async function listHomeDashboard(): Promise<{
  projects: ProjectListItem[];
  recentAnalyses: RecentAnalysisRow[];
  recentActivity: RecentActivityRow[];
}> {
  const store = await reloadStoreFromDisk();
  return listHomeDashboardFromStore(store);
}

export async function recordProjectOpen(projectId: string): Promise<void> {
  await updateStore((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.lastOpenedAt = now();
  });
}

export async function renameProject(projectId: string, name: string): Promise<ProjectListItem> {
  const trimmed = assertProjectName(name);
  let updated: Project | undefined;
  await updateStore((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found");
    if (projectNameTaken(store, trimmed, projectId)) {
      throw new Error(`A project named "${trimmed}" already exists.`);
    }
    project.name = trimmed;
    project.updatedAt = now();
    updated = project;
    logActivity(store, {
      projectId,
      actor: "human",
      category: "objective",
      action: "rename_project",
      summary: `Renamed project to "${trimmed}"`,
    });
  });
  if (!updated) throw new Error("Project not found");
  return {
    id: updated.id,
    name: updated.name,
    updatedAt: updated.updatedAt,
    lastOpenedAt: updated.lastOpenedAt,
    resumeNote: updated.resumeNote,
    geographyLabel: updated.geographyLabel,
  };
}

export async function deleteProject(projectId: string): Promise<void> {
  const storeBefore = await getStore();
  const deletingLastProject =
    storeBefore.projects.length === 1 &&
    storeBefore.projects.some((p) => p.id === projectId);
  await updateStore((store) => {
    const idx = store.projects.findIndex((p) => p.id === projectId);
    if (idx < 0) throw new Error("Project not found");
    const scenarioIds = new Set(
      store.scenarios.filter((s) => s.projectId === projectId).map((s) => s.id)
    );
    store.projects.splice(idx, 1);
    store.scenarios = store.scenarios.filter((s) => s.projectId !== projectId);
    store.decisions = store.decisions.filter((d) => d.projectId !== projectId);
    store.activities = store.activities.filter((a) => a.projectId !== projectId);
    store.confirmations = store.confirmations.filter((c) => c.projectId !== projectId);
    store.proposals = store.proposals.filter((p) => p.projectId !== projectId);
    store.analysisJobs = store.analysisJobs.filter((j) => !scenarioIds.has(j.scenarioId));
    store.analysisResults = store.analysisResults.filter((r) => !scenarioIds.has(r.scenarioId));
    store.reports = store.reports.filter((r) => r.projectId !== projectId);
  }, deletingLastProject ? { allowEmptyCatalog: true } : undefined);
}

function workspaceSnapshotFromStore(
  store: AppStore,
  projectId: string
): WorkspaceSnapshot | null {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const syncedMap = syncMapLayers(project.mapState, store.datasets);
  return {
    project:
      syncedMap.layers.length !== project.mapState.layers.length
        ? { ...project, mapState: syncedMap }
        : project,
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

async function repairActiveScenarioIfNeeded(projectId: string): Promise<void> {
  await updateStore((store) => {
    const repairId = activeScenarioNeedsRepair(store, projectId);
    if (!repairId) return;
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.activeScenarioId = repairId;
    project.updatedAt = now();
    const scenario = store.scenarios.find((s) => s.id === repairId);
    const result = scenario?.latestResultId
      ? store.analysisResults.find((r) => r.id === scenario.latestResultId)
      : undefined;
    project.resumeNote = scenario
      ? resumeNoteForScenario(scenario, result)
      : "Active scenario restored — review and recalculate if needed.";
    logActivity(store, {
      projectId,
      scenarioId: repairId,
      actor: "system",
      category: "scenario",
      action: "repair_active_scenario",
      summary: `Restored active scenario to "${scenario?.name ?? "default"}"`,
    });
  });
}

export async function getWorkspace(projectId: string): Promise<WorkspaceSnapshot | null> {
  await repairActiveScenarioIfNeeded(projectId);
  const store = await reloadStoreFromDisk();
  return workspaceSnapshotFromStore(store, projectId);
}

export async function createProject(input: {
  name: string;
  objectiveText: string;
  geographyLabel?: string;
  mode?: "explore" | "planning";
  fromExplore?: boolean;
}): Promise<WorkspaceSnapshot & { duplicateNameWarning?: boolean }> {
  const trimmedObjective = assertCreateObjectiveText(input.objectiveText);
  const trimmedName = assertProjectName(input.name);
  const storeBefore = await getStore();
  const duplicateNameWarning = projectNameTaken(storeBefore, trimmedName);
  let projectId = "";
  const storeAfter = await updateStore((store) => {
    const geographyLabel =
      typeof input.geographyLabel === "string" && input.geographyLabel.trim()
        ? input.geographyLabel.trim()
        : "Study area";
    const parsed = parseForStore(store, trimmedObjective, geographyLabel);
    const project: Project = {
      id: nanoid(),
      name: trimmedName,
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
    if (input.fromExplore) {
      project.resumeNote =
        "Converted from Explore scratch findings — review the analysis plan, then run analysis.";
      logActivity(store, {
        projectId: project.id,
        scenarioId: scenario.id,
        actor: "human",
        category: "objective",
        action: "convert_from_explore",
        summary: "Converted scratch Explore findings into this planning workspace",
      });
    }
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
  let ws = workspaceSnapshotFromStore(storeAfter, projectId);
  if (!ws) {
    const reloaded = await reloadStoreFromDisk();
    ws = workspaceSnapshotFromStore(reloaded, projectId);
  }
  if (!ws) {
    throw new Error(
      `Project was saved but could not be opened. Return to your project list and try again.`
    );
  }
  return duplicateNameWarning ? { ...ws, duplicateNameWarning: true } : ws;
}

export async function updateObjective(projectId: string, text: string) {
  const objectiveText = assertObjectiveTextAllowed(text);
  await updateStore((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    const scenario = store.scenarios.find((s) => s.id === project?.activeScenarioId);
    if (!project || !scenario) throw new ToolError("NOT_FOUND", "Project/scenario not found", "projectId");
    const parsed = parseForStore(store, objectiveText, project.geographyLabel);
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
      inputs: { text: objectiveText },
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
    touchProject(store, projectId, "Results stale — recalculate after constraint change.");
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

export async function excludeMapArea(
  projectId: string,
  scenarioId: string,
  selection: Omit<GeographicSelection, "id" | "createdAt" | "type">
) {
  const store = await reloadStoreFromDisk();
  requireScenario(store, projectId, scenarioId);
  return addGeographicSelection(projectId, scenarioId, {
    ...selection,
    type: "exclusion",
  });
}

export async function setMapView(
  projectId: string,
  view: { center: [number, number]; zoom?: number }
) {
  const store = await getStore();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
  return updateMapState(projectId, {
    viewport: {
      ...project.mapState.viewport,
      center: view.center,
      zoom: view.zoom ?? project.mapState.viewport.zoom,
    },
  });
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
    touchProject(store, projectId, "Results stale — recalculate after geographic change.");
    logActivity(store, {
      projectId,
      scenarioId,
      actor: selection.createdBy === "human" ? "human" : "agent",
      category: "map",
      action: "geographic_selection",
      summary: `${selection.type} area "${selection.label}" added by ${
        selection.createdBy === "human" ? "planner" : "AI agent"
      }`,
      inputs: { type: selection.type, label: selection.label, selectionId: full.id },
    });
  });
  return getWorkspace(projectId);
}

export async function removeGeographicSelection(
  projectId: string,
  scenarioId: string,
  selectionId: string
) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    const idx = scenario.geographicSelections.findIndex((s) => s.id === selectionId);
    if (idx < 0) throw new Error("Geographic selection not found");
    const removed = scenario.geographicSelections[idx];
    scenario.geographicSelections.splice(idx, 1);
    scenario.updatedAt = now();
    scenario.status = "draft";
    markResultsStale(store, scenario.id, "Geographic selection removed");
    touchProject(store, projectId, `Removed ${removed.type} "${removed.label}" — recalculate to restore candidates.`);
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "map",
      action: "remove_geographic_selection",
      summary: `Removed ${removed.type} area "${removed.label}" (${selectionId.slice(0, 6)})`,
      inputs: { selectionId, type: removed.type, label: removed.label },
    });
  });
  return getWorkspace(projectId);
}

export async function updateGeographicSelection(
  projectId: string,
  scenarioId: string,
  selectionId: string,
  patch: {
    label?: string;
    geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }
) {
  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    const sel = scenario.geographicSelections.find((s) => s.id === selectionId);
    if (!sel) throw new Error("Geographic selection not found");
    if (patch.label != null) {
      const trimmed = patch.label.trim();
      if (!trimmed) throw new Error("Geographic selection label is required");
      const duplicate = scenario.geographicSelections.some(
        (s) => s.id !== selectionId && s.label.toLowerCase() === trimmed.toLowerCase()
      );
      if (duplicate) throw new Error(`Another geographic area is already named "${trimmed}"`);
      sel.label = trimmed;
    }
    if (patch.geometry) sel.geometry = patch.geometry;
    scenario.updatedAt = now();
    scenario.status = "draft";
    markResultsStale(store, scenario.id, "Geographic selection updated");
    touchProject(store, projectId, `Updated geographic area "${sel.label}" — recalculate.`);
    logActivity(store, {
      projectId,
      scenarioId,
      actor: "human",
      category: "map",
      action: "update_geographic_selection",
      summary: `Updated ${sel.type} area "${sel.label}"`,
      inputs: { selectionId, label: sel.label },
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
  featureIds?: string[],
  scenarioId?: string
) {
  const store = await getStore();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
  const activeScenarioId = scenarioId ?? project.activeScenarioId;
  if (candidateId) {
    const scenario = store.scenarios.find(
      (s) => s.id === activeScenarioId && s.projectId === projectId
    );
    if (!scenario) throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
    const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
    const candidate = result?.candidates.find(
      (c) => c.id === candidateId || c.featureIds.includes(candidateId)
    );
    if (!candidate) {
      throw new ToolError("NOT_FOUND", `Candidate not found: ${candidateId}`, "candidateId");
    }
  }
  await updateStore((s) => {
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ToolError("NOT_FOUND", "Project not found", "projectId");
    p.mapState.selectedCandidateId = candidateId;
    p.mapState.selectedCandidateScenarioId = candidateId ? activeScenarioId : undefined;
    p.mapState.selectedFeatureIds =
      featureIds ?? (candidateId ? [candidateId] : []);
    p.mapState.highlightFeatureIds =
      featureIds ?? (candidateId ? [candidateId] : []);
    p.updatedAt = now();
  });
  return getWorkspace(projectId);
}

export async function addToShortlist(
  projectId: string,
  scenarioId: string,
  candidateId: string,
  options?: { reason?: string; note?: string }
) {
  const store = await getStore();
  const scenario = requireScenario(store, projectId, scenarioId);
  const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
  const candidate = findCandidateInResult(result, candidateId);
  if (!candidate) {
    throw new ToolError("NOT_FOUND", `Candidate not found: ${candidateId}`, "candidateId");
  }
  if (candidate.status === "rejected") {
    throw new ToolError(
      "INVALID_INPUT",
      "Cannot shortlist a rejected candidate",
      "candidateId"
    );
  }

  await updateStore((s) => {
    const scenarioLive = requireScenario(s, projectId, scenarioId);
    if (!scenarioLive.shortlist) scenarioLive.shortlist = [];
    const existing = findShortlistEntry(
      scenarioLive.shortlist,
      candidate.id,
      candidate.featureIds
    );
    if (existing) {
      existing.candidateId = candidate.id;
      existing.label = candidate.label;
      existing.featureIds = [...candidate.featureIds];
      if (options?.reason?.trim()) existing.reason = options.reason.trim();
      if (options?.note !== undefined) existing.note = options.note.trim() || undefined;
    } else {
      scenarioLive.shortlist.push({
        featureIds: [...candidate.featureIds],
        candidateId: candidate.id,
        label: candidate.label,
        pinnedAt: now(),
        reason: options?.reason?.trim() || undefined,
        note: options?.note?.trim() || undefined,
      });
    }
    scenarioLive.updatedAt = now();
    logActivity(s, {
      projectId,
      scenarioId,
      actor: "human",
      category: "decision",
      action: "shortlist_added",
      summary: `Pinned ${candidate.label} to candidate shortlist`,
      inputs: { candidateId: candidate.id, reason: options?.reason },
      relatedCandidateIds: [candidate.id],
    });
    touchProject(s, projectId, `Shortlist: ${candidate.label} pinned`);
  });
  return getWorkspace(projectId);
}

export async function removeFromShortlist(
  projectId: string,
  scenarioId: string,
  candidateId: string
) {
  const store = await getStore();
  const scenario = requireScenario(store, projectId, scenarioId);
  const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
  const candidate = findCandidateInResult(result, candidateId);
  const entries = shortlistEntries(scenario);
  const entry = findShortlistEntry(
    entries,
    candidateId,
    candidate?.featureIds
  );
  if (!entry) {
    throw new ToolError("NOT_FOUND", `Candidate not on shortlist: ${candidateId}`, "candidateId");
  }

  await updateStore((s) => {
    const scenarioLive = requireScenario(s, projectId, scenarioId);
    scenarioLive.shortlist = shortlistEntries(scenarioLive).filter(
      (e) =>
        e.candidateId !== entry.candidateId &&
        !featureIdsOverlap(e.featureIds, entry.featureIds)
    );
    scenarioLive.updatedAt = now();
    logActivity(s, {
      projectId,
      scenarioId,
      actor: "human",
      category: "decision",
      action: "shortlist_removed",
      summary: `Removed ${entry.label} from candidate shortlist`,
      inputs: { candidateId },
      relatedCandidateIds: entry.candidateId ? [entry.candidateId] : undefined,
    });
    touchProject(s, projectId, `Shortlist: ${entry.label} removed`);
  });
  return getWorkspace(projectId);
}

export async function updateShortlistNote(
  projectId: string,
  scenarioId: string,
  candidateId: string,
  note: string
) {
  const store = await getStore();
  const scenario = requireScenario(store, projectId, scenarioId);
  const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
  const candidate = findCandidateInResult(result, candidateId);
  const entry = findShortlistEntry(
    shortlistEntries(scenario),
    candidateId,
    candidate?.featureIds
  );
  if (!entry) {
    throw new ToolError("NOT_FOUND", `Candidate not on shortlist: ${candidateId}`, "candidateId");
  }

  await updateStore((s) => {
    const scenarioLive = requireScenario(s, projectId, scenarioId);
    const liveEntry = findShortlistEntry(
      shortlistEntries(scenarioLive),
      candidateId,
      candidate?.featureIds
    );
    if (!liveEntry) return;
    liveEntry.note = note.trim() || undefined;
    scenarioLive.updatedAt = now();
    touchProject(s, projectId, `Shortlist note updated for ${liveEntry.label}`);
  });
  return getWorkspace(projectId);
}

export function getShortlistForScenario(
  scenario: Scenario,
  result: AnalysisResult | undefined
) {
  return resolveShortlist(scenario, result);
}

function requireScenario(store: AppStore, projectId: string, scenarioId: string): Scenario {
  const resolvedId = resolveScenarioId(store, projectId, scenarioId);
  if (!resolvedId) throw new Error("Scenario not found");
  const scenario = store.scenarios.find(
    (s) => s.id === resolvedId && s.projectId === projectId
  );
  if (!scenario) throw new Error("Scenario not found");
  const project = store.projects.find((p) => p.id === projectId);
  if (project && project.activeScenarioId !== resolvedId) {
    project.activeScenarioId = resolvedId;
    project.updatedAt = now();
  }
  return scenario;
}

function touchProject(store: AppStore, projectId: string, resumeNote?: string) {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return;
  project.updatedAt = now();
  if (resumeNote) project.resumeNote = resumeNote;
}

export function resumeNoteForScenario(
  scenario: Scenario,
  result: AnalysisResult | undefined
): string {
  if (scenario.decisionStatus === "approved" && !scenario.decisionStale) {
    return `Decision recorded: ${formatDecisionType("approve_scenario")}`;
  }
  if (scenario.decisionStatus === "rejected" && !scenario.decisionStale) {
    return `Decision recorded: ${formatDecisionType("reject_scenario")}`;
  }
  if (scenario.decisionStatus === "changes_requested") {
    return `Decision recorded: ${formatDecisionType("request_changes")}`;
  }
  if (result && result.status === "completed" && result.candidates.length > 0) {
    const base = `Analysis complete — ${result.candidates.length} candidates (${scenario.name})`;
    const shortlistCount = scenario.shortlist?.length ?? 0;
    if (shortlistCount > 0) {
      return `${base} · ${shortlistCount} shortlisted.`;
    }
    return `${base}.`;
  }
  return "No analysis yet — run analysis for this scenario.";
}

export async function requireProject(projectId: string): Promise<Project> {
  const store = await reloadStoreFromDisk();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new ToolError("NOT_FOUND", "Project not found", "projectId");
  }
  return project;
}

export async function reconcileStaleRunningAnalysisJobs(
  projectId: string,
  scenarioId: string
): Promise<void> {
  await updateStore((store) => {
    for (const job of store.analysisJobs) {
      if (job.scenarioId !== scenarioId || job.status !== "running") continue;
      if (!isStaleRunningAnalysisJob(job)) continue;
      job.status = "failed";
      job.completedAt = now();
      job.error = staleRunningJobMessage();
      job.currentStep = "Interrupted";
      logActivity(store, {
        projectId,
        scenarioId,
        actor: "system",
        category: "analysis",
        action: "analysis_stale_cancelled",
        summary: job.error,
      });
    }
  });
}

export async function findCandidateForInspection(
  projectId: string,
  scenarioId: string,
  candidateId: string
) {
  const store = await getStore();
  const scenario = store.scenarios.find(
    (s) => s.id === scenarioId && s.projectId === projectId
  );
  if (!scenario?.latestResultId) return undefined;
  const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
  if (!result) return undefined;
  return findCandidateInStore(store, result, candidateId, { hydrate: true });
}

export async function listCandidatesPage(
  projectId: string,
  scenarioId: string,
  limit = 10,
  offset = 0
) {
  await repairActiveScenarioIfNeeded(projectId);
  const store = await getStore();
  const runStatus = await getAnalysisRunStatusFromStore(store, projectId, scenarioId);
  const scenario = store.scenarios.find(
    (s) => s.id === scenarioId && s.projectId === projectId
  );
  if (!scenario) {
    throw new ToolError("NOT_FOUND", "Scenario not found", "scenarioId");
  }
  const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
  if (runStatus.status === "failed") {
    return {
      status: "error" as const,
      error: runStatus.error ?? "Analysis failed",
      stale: result?.stale ?? true,
      summary: result?.summary ?? null,
      totalCount: result ? resultCandidateCount(result) : 0,
      offset: 0,
      limit: Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 10)),
      scoreSpread: result ? resultScoreSpread(result) : 0,
      candidates: [] as Array<{
        id: string;
        label: string;
        rank: number;
        score: number;
        status: string;
      }>,
    };
  }
  if (!result) {
    return null;
  }
  const all = Array.isArray(result.candidates) ? result.candidates : [];
  const totalCount = resultCandidateCount(result);
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 10));
  const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const page = all.slice(safeOffset, safeOffset + safeLimit);
  return {
    status: "ok" as const,
    stale: result.stale ?? false,
    summary: result.summary,
    totalCount,
    offset: safeOffset,
    limit: safeLimit,
    scoreSpread: resultScoreSpread(result),
    candidates: page.map((c) => ({
      id: c.id,
      label: c.label,
      rank: c.rank,
      score: c.score,
      status: c.status ?? "eligible",
    })),
  };
}

async function executeAnalysisComputation(
  projectId: string,
  scenarioId: string,
  jobId: string
): Promise<void> {
  if (analysisDelayMsForTests > 0) {
    await new Promise((resolve) => setTimeout(resolve, analysisDelayMsForTests));
  }

  const live = await getStore();
  const sc = requireScenario(live, projectId, scenarioId);
  const rejected = new Set(
    live.decisions
      .filter((d) => d.scenarioId === scenarioId && d.type === "reject_candidate")
      .map((d) => d.subjectId!)
      .filter(Boolean)
  );

  const output = runSpatialAnalysis({
    objective: sc.objective,
    constraints: sc.constraints,
    weights: sc.weights,
    assumptions: sc.assumptions,
    selections: sc.geographicSelections,
    layers: layersForScenario(live, sc),
    datasetIds: datasetIdsByKind(live),
    rejectedCandidateFeatureIds: rejected,
    externalLimitations: collectDatasetLimitations(live, sc),
  });

  try {
    await updateStore((s) => {
      const job = s.analysisJobs.find((j) => j.id === jobId);
      const scenarioLive = requireScenario(s, projectId, scenarioId);
      const currentHash = configHashFor(scenarioLive);

      if (!job) return;

      for (const step of output.stepLogs) {
        const ev = logActivity(s, {
          projectId,
          scenarioId,
          actor: "agent",
          category: "analysis",
          action: step.step,
          summary: step.detail,
          inputs: {
            scenario: scenarioLive.name,
            datasets: datasetSnapshot(s, scenarioLive),
          },
          outputs: {
            count: step.count,
            detail: step.detail,
          },
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

      const compactCandidates = output.candidates.map((c) =>
        compactCandidateForStore(c)
      ) as unknown as typeof output.candidates;

      const result: AnalysisResult = {
        id: nanoid(),
        jobId: job.id,
        scenarioId,
        status: "completed",
        createdAt: now(),
        completedAt: now(),
        candidates: compactCandidates,
        aggregateMetrics: output.aggregateMetrics,
        summary: output.summary,
        stepLogs: output.stepLogs,
        limitations: dedupeLimitations([
          ...output.limitations,
          ...collectDatasetLimitations(s, scenarioLive),
        ]),
        stale: false,
        configHash: job.configHash,
      };
      applyScoreStatsToResult(result, compactCandidates);

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

      if (scenarioLive.shortlist?.length) {
        scenarioLive.shortlist = remapShortlistAfterAnalysis(
          scenarioLive.shortlist,
          result.candidates
        );
      }

      s.analysisResults.push(result);
      scenarioLive.latestResultId = result.id;
      dedupeAnalysisResultsPerScenario(s);
      job.status = "completed";
      job.progress = 100;
      job.completedAt = now();
      job.currentStep = "Complete";
      scenarioLive.updatedAt = now();
      markReportsStaleForScenario(
        s,
        scenarioId,
        "Analysis recalculated — regenerate report to include latest results."
      );
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
        inputs: {
          scenario: scenarioLive.name,
          datasets: datasetSnapshot(s, scenarioLive),
          configHash: job.configHash,
        },
        outputs: {
          candidateCount: output.candidates.length,
          topCandidate: output.candidates[0]?.label,
          aggregateMetrics: Object.fromEntries(
            result.aggregateMetrics.map((m) => [m.key, m.value])
          ),
        },
        relatedCandidateIds: output.candidates.slice(0, 5).map((c) => c.id),
      });
      touchProject(
        s,
        projectId,
        resumeNoteForScenario(
          scenarioLive,
          s.analysisResults.find((r) => r.id === scenarioLive.latestResultId)
        )
      );
    });
  } catch (err) {
    if (err instanceof StorePersistError) {
      await updateStore((s) => {
        const job = s.analysisJobs.find((j) => j.id === jobId);
        if (job && job.status === "running") {
          job.status = "failed";
          job.completedAt = now();
          job.error =
            "Analysis finished but results could not be saved. Your project and scenarios are intact — retry analysis.";
          job.currentStep = "Results not saved";
        }
        const scenarioLive = requireScenario(s, projectId, scenarioId);
        if (scenarioLive.analysisPlan) {
          scenarioLive.analysisPlan.steps = scenarioLive.analysisPlan.steps.map((st) => ({
            ...st,
            status: st.status === "completed" ? "completed" : "pending",
          }));
        }
        logActivity(s, {
          projectId,
          scenarioId,
          actor: "system",
          category: "analysis",
          action: "analysis_persist_failed",
          summary: job?.error ?? "Results not saved to disk",
        });
        touchProject(
          s,
          projectId,
          "Analysis finished but results were not saved — retry when storage is healthy."
        );
      });
      return;
    }
    await updateStore((s) => {
      const job = s.analysisJobs.find((j) => j.id === jobId);
      if (job && job.status === "running") {
        job.status = "failed";
        job.completedAt = now();
        job.error = err instanceof Error ? err.message : "Analysis failed";
        job.currentStep = "Failed";
      }
      logActivity(s, {
        projectId,
        scenarioId,
        actor: "system",
        category: "analysis",
        action: "analysis_failed",
        summary: job?.error ?? "Analysis failed",
      });
      touchProject(s, projectId, "Analysis failed — review constraints and retry.");
    });
    throw err;
  }
}

export async function getAnalysisRunStatus(projectId: string, scenarioId: string) {
  const store = await getStore();
  return getAnalysisRunStatusFromStore(store, projectId, scenarioId);
}

function getAnalysisRunStatusFromStore(
  store: AppStore,
  projectId: string,
  scenarioId: string
) {
  const scenario = store.scenarios.find((s) => s.id === scenarioId && s.projectId === projectId);
  if (!scenario) {
    return { status: "not_found" as const };
  }

  const jobs = store.analysisJobs.filter((j) => j.scenarioId === scenarioId);
  const runningJob = [...jobs].reverse().find((j) => j.status === "running");
  if (runningJob) {
    return {
      status: "running" as const,
      jobId: runningJob.id,
      progress: runningJob.progress,
      currentStep: runningJob.currentStep ?? "Running analysis",
    };
  }

  const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
  const failedJob = [...jobs].reverse().find((j) => j.status === "failed");
  if (
    failedJob &&
    (!result?.completedAt || (failedJob.completedAt ?? "") >= result.completedAt)
  ) {
    return { status: "failed" as const, error: failedJob.error ?? "Analysis failed" };
  }

  if (result && (result.status === "completed" || result.status === "stale")) {
    const top = result.candidates[0];
    return {
      status: "completed" as const,
      summary: result.summary,
      candidateCount: resultCandidateCount(result),
      resultJobId: result.jobId,
      top: top
        ? { id: top.id, label: top.label, score: top.score }
        : null,
      limitations: result.limitations ?? [],
      stale: result.stale ?? false,
    };
  }

  return { status: "none" as const };
}

export async function runAnalysis(projectId: string, scenarioId: string) {
  await requireProject(projectId);
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

  await withAnalysisGate(projectId, async () => {
    await updateStore((s) => {
      const project = s.projects.find((p) => p.id === projectId);
      const sc = requireScenario(s, projectId, scenarioId);
      const { intentChanged, previousIntent } = reconcileScenarioObjectiveFromRawText(
        s,
        sc,
        project?.geographyLabel ?? "Study area"
      );
      if (intentChanged) {
        markResultsStale(
          s,
          scenarioId,
          `Objective re-parsed (${previousIntent} → ${sc.objective.intent})`
        );
        logActivity(s, {
          projectId,
          scenarioId,
          actor: "system",
          category: "objective",
          action: "reconcile_objective",
          summary: `Re-parsed objective intent before analysis (${previousIntent} → ${sc.objective.intent})`,
          inputs: { rawText: sc.objective.rawText },
          outputs: { intent: sc.objective.intent },
        });
      }
      const configHash = configHashFor(sc);
      markResultsStale(s, scenarioId, "Analysis recalculation in progress");
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
        inputs: {
          scenario: sc.name,
          configHash,
          datasets: datasetSnapshot(s, sc),
          intent: sc.objective.intent,
        },
      });
      touchProject(s, projectId, "Analysis running…");
    });
  });

  const runComputation = async () => {
    try {
      await executeAnalysisComputation(projectId, scenarioId, jobId);
    } catch (err) {
      if (err instanceof StorePersistError) {
        throw err;
      }
      console.error("[analysis] background job failed:", err);
    }
  };

  if (shouldRunAnalysisSynchronously()) {
    try {
      await withAnalysisGate(projectId, runComputation);
    } catch (err) {
      if (err instanceof StorePersistError) {
        const ws = await getWorkspace(projectId);
        if (!ws) throw err;
        return {
          ...ws,
          persistError: {
            code: "RESULTS_NOT_SAVED" as const,
            message:
              "Analysis completed but results could not be saved. Project and scenario metadata were kept.",
          },
        };
      }
      throw err;
    }
    const latest = await getStore();
    return workspaceSnapshotFromStore(latest, projectId)!;
  }

  setImmediate(() => {
    void withAnalysisGate(projectId, runComputation);
  });

  const latest = await getStore();
  return workspaceSnapshotFromStore(latest, projectId)!;
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
      ? store.scenarios.find(
          (s) => s.id === fromScenarioId && s.projectId === projectId
        )
      : store.scenarios.find((s) => s.id === project.activeScenarioId);

    if (fromScenarioId && !source) {
      throw new Error("Source scenario not found");
    }

    const createdAt = now();
    const scenario: Scenario = source
      ? cloneScenarioForBranch(source, nanoid(), name, createdAt)
      : (() => {
          const parsed = parseForStore(store, "Explore planning options", project.geographyLabel);
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

    if (source && isFloodWeightedBranchName(name)) {
      scenario.weights = applyFloodWeightedWeights(scenario.weights);
    }

    store.scenarios.push(scenario);
    project.activeScenarioId = scenario.id;
    project.updatedAt = now();
    const branchResult = scenario.latestResultId
      ? store.analysisResults.find((r) => r.id === scenario.latestResultId)
      : undefined;
    project.resumeNote = source
      ? isFloodWeightedBranchName(name)
        ? `Created flood-weighted branch "${name}" from "${source.name}" (${Math.round(
            (scenario.weights.find((w) => w.key.includes("flood"))?.weight ?? 0) * 100
          )}% flood) — run analysis on this branch to compare flood weighting.`
        : `Created branch "${name}" from "${source.name}" — configure weights and run analysis on this branch.`
      : resumeNoteForScenario(scenario, branchResult);
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
  const current = await reloadStoreFromDisk();
  const project = current.projects.find((p) => p.id === projectId);
  if (!project) throw new Error("Project not found");
  if (project.activeScenarioId === scenarioId) {
    return getWorkspace(projectId);
  }

  await updateStore((store) => {
    const scenario = requireScenario(store, projectId, scenarioId);
    const activeProject = store.projects.find((p) => p.id === projectId)!;
    activeProject.activeScenarioId = scenarioId;
    if (
      activeProject.mapState.selectedCandidateScenarioId &&
      activeProject.mapState.selectedCandidateScenarioId !== scenarioId
    ) {
      activeProject.mapState.selectedCandidateId = undefined;
      activeProject.mapState.selectedCandidateScenarioId = undefined;
      activeProject.mapState.selectedFeatureIds = [];
      activeProject.mapState.highlightFeatureIds = [];
    }
    activeProject.updatedAt = now();
    const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
    activeProject.resumeNote = resumeNoteForScenario(scenario, result);
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
    if (!scenario) {
      throw new ToolError("NOT_FOUND", `Scenario not found: ${id}`, "scenarioIds");
    }
    const result = store.analysisResults.find((r) => r.id === scenario.latestResultId);
    return {
      scenarioId: id,
      name: scenario.name,
      weights: scenario.weights,
      housingTarget:
        scenario.objective.intent === "housing_capacity"
          ? scenario.objective.targetValue
          : undefined,
      intent: scenario.objective.intent,
      shortlist: scenario.shortlist,
      result: result
        ? {
            candidates: result.candidates,
            aggregateMetrics: result.aggregateMetrics,
            summary: result.summary,
            limitations: result.limitations,
            stepLogs: result.stepLogs ?? [],
            status: result.status,
            stale: result.stale,
          }
        : null,
    };
  });
  const missingAnalysis = rows.filter(
    (r) => !r.result || r.result.status !== "completed" || r.result.stale
  );
  if (scenarioIds.length >= 2 && missingAnalysis.length > 0) {
    return {
      comparison: [],
      insights: [],
      scenarios: scenarioIds.map((id) => store.scenarios.find((s) => s.id === id)),
      status: "incomplete" as const,
      message: `Run analysis first for: ${missingAnalysis.map((r) => r.name).join(", ")}`,
    };
  }
  const enriched = enrichComparisonRows(rows);
  const inputSnapshots: ScenarioInputSnapshot[] = rows.map((r) => {
    const scenario = store.scenarios.find((s) => s.id === r.scenarioId)!;
    return {
      scenarioId: r.scenarioId,
      name: r.name,
      weights: scenario.weights,
      constraints: scenario.constraints,
      assumptions: scenario.assumptions,
      objective: scenario.objective,
    };
  });
  const inputsDiff = buildScenarioInputsDiff(inputSnapshots);
  const tableRows = buildCompareTableRows(enriched);
  const housingTargets = buildHousingTargetSummaries(enriched);
  const metricsIdentical = comparisonResultsIdentical(enriched);

  return {
    comparison: enriched,
    tableRows,
    inputsDiff,
    housingTargets,
    metricsIdentical,
    insights: buildComparisonInsights(rows),
    scenarios: scenarioIds.map((id) => store.scenarios.find((s) => s.id === id)),
    rankScoreNote: RANK_SCORE_EXPLANATION,
    status: "ready" as const,
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
        if (scenario.shortlist?.length) {
          scenario.shortlist = scenario.shortlist.filter(
            (e) =>
              e.candidateId !== candidate.id &&
              !candidate.featureIds.some((fid) => e.featureIds.includes(fid))
          );
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
    touchProject(s, input.projectId, `Decision recorded: ${formatDecisionType(input.type)}`);
    if (
      input.type === "approve_scenario" ||
      input.type === "reject_scenario" ||
      input.type === "request_changes"
    ) {
      markReportsStaleForScenario(
        s,
        input.scenarioId,
        `Planner decision recorded after this report was generated (${formatDecisionType(input.type)}).`
      );
    }
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
    const schoolUnderserved = result.aggregateMetrics.find(
      (m) => m.key === "total_school_underserved_pop"
    )?.value;
    const parkUnderserved = result.aggregateMetrics.find(
      (m) => m.key === "total_park_underserved_pop"
    )?.value;
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
      body: (() => {
        const usedIds = datasetIdsUsedByAnalysisPlan(store, sc);
        const usedDatasets = store.datasets.filter((d) => usedIds.has(d.id));
        const unusedEnabled = store.datasets.filter(
          (d) =>
            d.enabled &&
            sc.enabledDatasetIds.includes(d.id) &&
            !usedIds.has(d.id)
        );
        const formatDs = (d: (typeof store.datasets)[0]) => {
          const synced = formatReportDateTime(d.updatedAt);
          const vintage = d.dataVintage ? `; data vintage ${d.dataVintage}` : "";
          const synth = d.synthetic ? " (synthetic seed data)" : "";
          const limits =
            d.limitations.length > 0 ? ` — Limitations: ${d.limitations.join("; ")}` : "";
          return `${d.name} v${d.version} — ${d.source}; catalog synced ${synced}${vintage}${synth}${limits}`;
        };
        const lines = usedDatasets.map(formatDs);
        if (unusedEnabled.length) {
          lines.push(
            "",
            "Enabled in catalog but not used by this scenario's analysis plan:",
            ...unusedEnabled.map((d) => `• ${d.name} v${d.version} (not in plan)`)
          );
        }
        return lines.join("\n");
      })(),
    });

    sections.push({
      heading: `Assumptions — ${sc.name}`,
      kind: "calculated",
      body: sc.assumptions
        .map((a) => `${a.label}: ${a.value}${a.unit ? ` ${a.unit}` : ""} — ${a.description}`)
        .join("\n"),
    });

    const geoLines = sc.geographicSelections.map(
      (g) => `${g.label} (${g.type}, ${g.createdBy})`
    );
    sections.push({
      heading: `Constraints — ${sc.name}`,
      kind: "calculated",
      body: [
        ...sc.constraints
          .filter((c) => c.enabled)
          .map((c) => `${c.label} (${c.hard ? "hard" : "soft"})`),
        ...geoLines,
      ].join("\n"),
    });

    const targetGap = result.aggregateMetrics.find((m) => m.key === "housing_target_gap");
    const resultsBody = [
      result.summary,
      housingTarget != null && totalCapacity != null
        ? totalCapacity >= housingTarget
          ? `Housing goal: ${totalCapacity.toLocaleString()} estimated homes — meets ${housingTarget.toLocaleString()}-home target.`
          : `Housing goal: ${totalCapacity.toLocaleString()} estimated homes — ${(housingTarget - totalCapacity).toLocaleString()} short of ${housingTarget.toLocaleString()}-home target${targetGap ? ` (${targetGap.method})` : ""}.`
        : isAccessIntent(sc.objective.intent) && schoolUnderserved != null
          ? `School access gap: ${schoolUnderserved.toLocaleString()} people lack adequate school access across ranked areas.`
          : isAccessIntent(sc.objective.intent) && parkUnderserved != null
            ? `Park access gap: ${parkUnderserved.toLocaleString()} people lack adequate park access across ranked areas.`
            : "",
      sc.objective.excludesHousing
        ? "This analysis excludes housing production metrics per the stated objective."
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

    const shortlist = resolveShortlist(sc, result);
    if (shortlist.length > 0) {
      sections.push({
        heading: `Candidate shortlist — ${sc.name}`,
        kind: "planner_decision",
        body: shortlist
          .map((entry) => {
            const rank = entry.candidate?.rank;
            const score = entry.candidate?.score;
            const rankLine =
              rank != null && score != null
                ? `Rank ${rank}, score ${score.toFixed(1)}`
                : "Not in current results";
            const noteLine = entry.note ? `\nNote: ${entry.note}` : "";
            return `• ${entry.label} — ${rankLine}\n  Why pinned: ${shortlistPinReason(entry)}${noteLine}`;
          })
          .join("\n\n"),
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
      body: `${RANK_SCORE_EXPLANATION} Side-by-side metrics across selected scenarios.`,
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
      scenarioId: scenarioIds[0],
      actor: "agent",
      category: "report",
      action: "generate_report",
      summary: `Generated report "${report.title}" at ${generatedAt}`,
      inputs: {
        scenarioIds,
        scenarios: scenarioIds.map((id) => scenarioLabel(s, id)).filter(Boolean),
      },
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
        if (scenarioUsesDataset(store, scenario, datasetId)) {
          markResultsStale(store, scenario.id, `Dataset ${ds.name} disabled`);
        }
      }
    }
    logActivity(store, {
      projectId: store.projects[0]?.id ?? "system",
      actor: "human",
      category: "data",
      action: enabled ? "enable_dataset" : "disable_dataset",
      summary: `${enabled ? "Enabled" : "Disabled"} dataset ${ds.name} (global catalog)`,
      inputs: { datasetId, version: ds.version },
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
      ds.limitations = dedupeLimitations([
        ...ds.limitations,
        "Marked outdated — verify before relying on recommendations",
      ]);
      for (const scenario of store.scenarios) {
        if (scenarioUsesDataset(store, scenario, datasetId)) {
          markResultsStale(
            store,
            scenario.id,
            `Dataset ${ds.name} marked outdated`
          );
        }
      }
    } else {
      ds.limitations = ds.limitations.filter(
        (l) => l !== "Marked outdated — verify before relying on recommendations"
      );
    }
    const affectedScenarios = store.scenarios.filter((s) =>
      scenarioUsesDataset(store, s, datasetId)
    );
    const projectId = store.projects[0]?.id ?? "system";
    logActivity(store, {
      projectId,
      actor: "human",
      category: "data",
      action: stale ? "mark_dataset_stale" : "clear_dataset_stale",
      summary: stale
        ? `Marked outdated dataset ${ds.name} (global catalog) — ${affectedScenarios.length} scenario(s) with stale results`
        : `Cleared outdated flag on ${ds.name} (global catalog). Analysis results were not restored — recalculate affected scenarios before relying on recommendations.`,
      inputs: {
        datasetId,
        version: ds.version,
        dataVintage: ds.dataVintage,
        affectedScenarioCount: affectedScenarios.length,
      },
      relatedDatasetIds: [datasetId],
    });
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
      if (scenarioUsesDataset(store, scenario, datasetId)) {
        markResultsStale(store, scenario.id, `Underlying data changed for ${featureId}`);
      }
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
  assertProposalAction(input.action, input.payload);
  const title = humanizeProposalTitle(input.title, input.action);
  const description = input.description.trim() || title;
  let proposalId = "";
  await updateStore((store) => {
    const scenario = requireScenario(store, input.projectId, input.scenarioId);
    const proposal: StagedProposal = {
      id: nanoid(),
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      title,
      description,
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

  if (!proposal) {
    return {
      status: "nothing_to_verify" as const,
      verified: false,
      message: proposalId
        ? "No proposal found with that id for this project"
        : "No approved operation with receipt found for this project",
    };
  }

  if (!proposal.receiptSha256) {
    return {
      status: "pending" as const,
      verified: false,
      proposalId: proposal.id,
      action: proposal.action,
      message: "Proposal exists but has not been approved yet — nothing to verify",
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
  const verified = computed === proposal.receiptSha256;

  return {
    status: verified ? ("verified" as const) : ("failed" as const),
    verified,
    receiptSha256: proposal.receiptSha256,
    computedSha256: computed,
    proposalId: proposal.id,
    action: proposal.action,
    message: verified
      ? "Receipt matches the approved operation"
      : "Receipt hash mismatch — verification failed",
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
      parks: layers.parks,
      population: layers.population,
    },
    datasets: store.datasets.filter((d) => d.enabled),
  };
}

export async function getFeatures(datasetId: string) {
  const store = await getStore();
  return store.featuresByDataset[datasetId] ?? null;
}
