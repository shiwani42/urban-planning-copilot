"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  ProvenanceChip,
  useWorkspace,
} from "@/components/workspace-hooks";
import { StorageBanner } from "@/components/StorageBanner";
import { DatasetInspectPanel } from "@/components/DatasetInspectPanel";
import { onWorkspaceMutated } from "@/lib/workspace-sync";
import { setWebMcpBrowserContext, clearWebMcpBrowserContext } from "@/lib/webmcp/browser-context";
import {
  listPendingPlannerActions,
  onPlannerPending,
  type PendingPlannerAction,
} from "@/lib/planner-pending";
import { resolvePendingPlannerAction } from "@/lib/webmcp/register-browser";
import {
  dedupeLimitations,
  formatActivitySummary,
  formatDecisionStatus,
  formatDecisionType,
  formatLocaleDateTime,
  formatLocaleTime,
  formatReportDateTime,
} from "@/lib/format";
import { trackRecentProject } from "@/lib/project-recency";
import {
  normalizeTransitThresholdMeters,
} from "@/lib/domain/transit-threshold";
import type {
  Candidate,
  CriterionWeight,
  DatasetMeta,
  GeographicSelection,
  PlanningIntent,
  WorkspaceSnapshot,
} from "@/lib/domain/types";
import {
  polygonFromRing,
  ringFromPolygon,
  uniqueGeographicLabel,
} from "@/lib/domain/geographic";
import { isHousingIntent } from "@/lib/domain/intent";
import {
  evidenceMetricsForCandidate,
  headlineMetric,
  housingGoalSummary,
  resultsColumnsForIntent,
  type ResultsColumn,
} from "@/lib/domain/results-display";
import { filterAnalysisCaveats } from "@/lib/domain/caveats";
import { layerSwatch } from "@/lib/domain/layer-styles";
import { rebalanceWeights } from "@/lib/domain/weights";
import type { MapDrawMode } from "@/components/PlanningMap";

const PlanningMap = dynamic(
  () => import("@/components/PlanningMap").then((m) => m.default),
  { ssr: false }
);
const MapLegend = dynamic(
  () => import("@/components/PlanningMap").then((m) => m.MapLegend),
  { ssr: false }
);

type Tab =
  | "workspace"
  | "results"
  | "evidence"
  | "compare"
  | "decision"
  | "activity"
  | "report";

type DrawerPanel = "candidates" | "evidence";

const TAB_LABELS: Record<Tab, string> = {
  workspace: "Workspace",
  results: "Results",
  evidence: "Evidence",
  compare: "Compare",
  decision: "Decision",
  activity: "Activity",
  report: "Report",
};

const TAB_PATHS: Tab[] = [
  "workspace",
  "results",
  "evidence",
  "compare",
  "decision",
  "activity",
  "report",
];

export default function WorkspaceClient({
  projectId,
  initialTab = "workspace",
}: {
  projectId: string;
  initialTab?: Tab;
}) {
  const router = useRouter();
  const { workspace, loading, error, busy, act, refresh } = useWorkspace(projectId);
  const [tab, setTabState] = useState<Tab>(
    TAB_PATHS.includes(initialTab as Tab) ? (initialTab as Tab) : "workspace"
  );
  const [layerData, setLayerData] = useState<Record<string, GeoJSON.FeatureCollection>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPanel, setDrawerPanel] = useState<DrawerPanel>("candidates");
  const [drawMode, setDrawMode] = useState<MapDrawMode>("none");
  const [drawClicks, setDrawClicks] = useState<[number, number][]>([]);
  const [editingSelectionId, setEditingSelectionId] = useState<string | null>(null);
  const [finishLabelDraft, setFinishLabelDraft] = useState("");
  const [showFinishLabel, setShowFinishLabel] = useState(false);
  const [renamingExclusionId, setRenamingExclusionId] = useState<string | null>(null);
  const [exclusionLabelDraft, setExclusionLabelDraft] = useState("");
  const [weightDraft, setWeightDraft] = useState<CriterionWeight[] | null>(null);
  const [decisionReasonByScenario, setDecisionReasonByScenario] = useState<Record<string, string>>(
    {}
  );
  const [confirmDecision, setConfirmDecision] = useState<
    "approve_scenario" | "reject_scenario" | "request_changes" | null
  >(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Array<Record<string, string | number>> | null>(
    null
  );
  const [compareInsights, setCompareInsights] = useState<
    Array<{ heading: string; body: string }> | null
  >(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareHint, setCompareHint] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [legendDocked, setLegendDocked] = useState(true);
  const [inspectDatasetId, setInspectDatasetId] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [renamingScenarioId, setRenamingScenarioId] = useState<string | null>(null);
  const [scenarioNameDraft, setScenarioNameDraft] = useState("");
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [selectionUpdated, setSelectionUpdated] = useState(false);
  const [lastResultId, setLastResultId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [transitDraftText, setTransitDraftText] = useState<Record<string, string>>({});
  const [transitThresholdWarning, setTransitThresholdWarning] = useState<string | null>(null);
  const [criteriaStaleHint, setCriteriaStaleHint] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [pendingPlannerActions, setPendingPlannerActions] = useState<PendingPlannerAction[]>([]);
  const [pendingBusy, setPendingBusy] = useState(false);

  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      const path =
        next === "workspace"
          ? `/workspace/${projectId}`
          : `/workspace/${projectId}/${next}`;
      router.replace(path, { scroll: false });
    },
    [projectId, router]
  );

  useEffect(() => {
    if (TAB_PATHS.includes(initialTab as Tab) && initialTab !== tab) {
      setTabState(initialTab as Tab);
    }
  }, [initialTab, tab]);

  const scenario = useMemo(() => {
    const activeId = workspace?.project?.activeScenarioId;
    if (!workspace || !activeId) return undefined;
    return workspace.scenarios.find((s) => s.id === activeId);
  }, [workspace]);

  const result = useMemo(() => {
    if (!workspace || !scenario?.latestResultId) return undefined;
    return workspace.analysisResults.find((r) => r.id === scenario.latestResultId);
  }, [workspace, scenario?.latestResultId]);

  const hasAnyResult = Boolean(result);
  const isFreshResult = Boolean(result && result.status === "completed" && !result.stale);
  const candidates = result?.candidates ?? [];
  const topCandidate = useMemo(() => {
    if (!result?.candidates.length) return null;
    return (
      result.candidates.find((c) => c.rank === 1) ??
      [...result.candidates].sort((a, b) => a.rank - b.rank)[0]
    );
  }, [result]);
  const selectedCandidate = useMemo(() => {
    const id = workspace?.project?.mapState.selectedCandidateId;
    const selectionScenarioId = workspace?.project?.mapState.selectedCandidateScenarioId;
    if (!id || !candidates.length || !scenario) return null;
    if (selectionScenarioId && selectionScenarioId !== scenario.id) return null;
    return candidates.find((x) => x.id === id || x.featureIds.includes(id)) ?? null;
  }, [
    workspace?.project?.mapState.selectedCandidateId,
    workspace?.project?.mapState.selectedCandidateScenarioId,
    candidates,
    scenario?.id,
  ]);
  const decisionReason = scenario ? (decisionReasonByScenario[scenario.id] ?? "") : "";
  const runningJob = workspace?.analysisJobs.find(
    (j) => j.scenarioId === scenario?.id && j.status === "running"
  );

  useEffect(() => {
    fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record_open" }),
    }).catch(() => {
      /* non-blocking home recency hint */
    });
  }, [projectId]);

  useEffect(() => {
    if (!workspace) return;
    Promise.all(
      workspace.datasets.map(async (d) => {
        const res = await fetch(`/api/datasets?id=${d.id}`);
        const data = await res.json();
        return [d.kind, data.features] as const;
      })
    ).then((entries) => {
      const map: Record<string, GeoJSON.FeatureCollection> = {};
      for (const [kind, fc] of entries) {
        if (fc) map[kind] = fc;
      }
      setLayerData(map);
    });
  }, [workspace?.datasets]);

  useEffect(() => {
    if (!workspace?.project) return;
    trackRecentProject(workspace.project.id, workspace.project.name);
  }, [workspace?.project?.id, workspace?.project?.name]);

  useEffect(() => {
    if (!workspace?.project?.mapState.selectedCandidateId) return;
    if (selectedCandidate && result?.id && result.id !== lastResultId) {
      setSelectionUpdated(true);
      setLastResultId(result.id);
    }
  }, [
    workspace?.project?.mapState.selectedCandidateId,
    selectedCandidate,
    result?.id,
    lastResultId,
  ]);

  useEffect(() => {
    if (!scenario) return;
    setCompareHint(null);
  }, [scenario?.id, scenario?.latestResultId]);

  useEffect(() => {
    if (scenario) setWeightDraft(scenario.weights);
  }, [scenario?.id, scenario?.updatedAt]);

  useEffect(() => {
    if (!scenario) return;
    setTransitDraftText({});
    setTransitThresholdWarning(null);
  }, [scenario?.id, scenario?.updatedAt]);

  useEffect(() => {
    if (tab !== "compare" || !workspace) return;
    const withResults = workspace.scenarios.filter((s) =>
      workspace.analysisResults.some((r) => r.id === s.latestResultId)
    );
    if (withResults.length >= 2) {
      setCompareIds(withResults.map((s) => s.id));
      return;
    }
    if (!scenario) return;
    const parent = scenario.parentScenarioId
      ? workspace.scenarios.find((s) => s.id === scenario.parentScenarioId)
      : undefined;
    const ids = new Set<string>([scenario.id]);
    if (parent) ids.add(parent.id);
    if (ids.size >= 2) {
      setCompareIds([...ids]);
    } else if (compareIds.length === 0) {
      setCompareIds([scenario.id]);
    }
  }, [tab, workspace, scenario?.id, scenario?.parentScenarioId, compareIds.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setWebMcpBrowserContext({ projectId, scenarioId: scenario?.id });
    return () => clearWebMcpBrowserContext(["projectId", "scenarioId"]);
  }, [projectId, scenario?.id]);

  useEffect(() => {
    setPendingPlannerActions(listPendingPlannerActions(projectId));
    return onPlannerPending((detail) => {
      if (detail.projectId === projectId) {
        setPendingPlannerActions(detail.actions);
      }
    });
  }, [projectId]);

  useEffect(() => {
    return onWorkspaceMutated((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      if (detail.criteriaStale) setCriteriaStaleHint(true);
      if (detail.resumeNote?.match(/stale|recalculate/i)) setCriteriaStaleHint(true);
    });
  }, [projectId]);

  useEffect(() => {
    if (result?.stale) setCriteriaStaleHint(false);
  }, [result?.stale, result?.id]);

  const drawingActive = drawMode !== "none";

  useEffect(() => {
    if (!drawingActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelDrawing();
      } else if (e.key === "Backspace" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        undoDrawVertex();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawingActive, drawMode, drawClicks.length, editingSelectionId]);

  const syncedMapLayers = useMemo(() => {
    if (!workspace) return [];
    const existing = new Map(workspace.project.mapState.layers.map((l) => [l.datasetId, l]));
    return workspace.datasets.map((d) =>
      existing.get(d.id) ?? {
        datasetId: d.id,
        visible: ["parcels", "transit", "flood", "population", "schools", "parks"].includes(d.kind),
      }
    );
  }, [workspace]);

  const visibleLayerKinds = useMemo(() => {
    if (!workspace) return new Set<string>();
    const ids = new Set(syncedMapLayers.filter((l) => l.visible).map((l) => l.datasetId));
    return new Set(workspace.datasets.filter((d) => ids.has(d.id)).map((d) => d.kind));
  }, [workspace, syncedMapLayers]);

  const floodCoverageWarning = useMemo(() => {
    if (!workspace || !result) return null;
    const flood = workspace.datasets.find((d) => d.kind === "flood");
    if (!flood || (!flood.incompleteCoverage && flood.featureCount > 1)) return null;
    const floodLog = result.stepLogs?.find((s) => /flood/i.test(s.detail));
    if (!floodLog) return null;
    const excluded = floodLog.detail.match(/(\d+)\s*→\s*(\d+)/);
    if (!excluded) return null;
    const before = Number(excluded[1]);
    const after = Number(excluded[2]);
    if (before - after < 10) return null;
    return `Flood layer has incomplete coverage (${flood.featureCount} feature${flood.featureCount === 1 ? "" : "s"}). ${before - after} parcels were excluded — verify site-specific flood risk before decisions.`;
  }, [workspace, result]);

  function openDatasetInspect(datasetId: string) {
    setInspectDatasetId(datasetId);
    setTab("evidence");
    requestAnimationFrame(() => {
      document.getElementById(`dataset-${datasetId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  const selectCandidate = useCallback(
    async (c: Candidate, panel: DrawerPanel = "evidence") => {
      if (!scenario) return;
      const rowIndex = candidates.findIndex((x) => x.id === c.id);
      if (rowIndex >= 0) setFocusedRowIndex(rowIndex);
      setDrawerOpen(true);
      setDrawerPanel(panel);
      setTab("results");
      await act("select_candidate", {
        scenarioId: scenario.id,
        candidateId: c.id,
        featureIds: c.featureIds,
      });
    },
    [act, candidates, scenario, setTab]
  );

  const weightSum = useMemo(() => {
    const draft = weightDraft ?? scenario?.weights ?? [];
    return draft.reduce((sum, w) => sum + w.weight, 0) * 100;
  }, [weightDraft, scenario?.weights]);

  const weightSumRounded = Math.round(weightSum);

  const housingTarget =
    scenario?.objective.intent === "housing_capacity"
      ? scenario.objective.targetValue
      : undefined;
  const totalCapacity = result?.aggregateMetrics.find((m) => m.key === "total_capacity")?.value;
  const enabledDatasetCount =
    scenario?.enabledDatasetIds.filter((id) =>
      workspace?.datasets.some((d) => d.id === id && d.enabled)
    ).length ?? workspace?.datasets.filter((d) => d.enabled).length ?? 0;
  const targetGap = result?.aggregateMetrics.find((m) => m.key === "housing_target_gap");
  const accessHeadline =
    scenario && result
      ? headlineMetric(scenario.objective.intent, result.aggregateMetrics)
      : null;
  const hasParksDataset = Boolean(workspace?.datasets.some((d) => d.kind === "parks" && d.enabled));
  const resultsColumns = scenario
    ? resultsColumnsForIntent(scenario.objective.intent, hasParksDataset)
    : [];

  function constraintFunnelDetail(constraintLabel: string): string | null {
    if (!result?.stepLogs) return null;
    const match = result.stepLogs.find((log) =>
      log.detail.toLowerCase().includes(constraintLabel.toLowerCase().slice(0, 20))
    );
    return match?.detail ?? null;
  }

  function floodConstraintStatus(): "excluded" | "no_overlap" | "unknown" {
    const detail = constraintFunnelDetail("flood");
    if (!detail) return "unknown";
    if (detail.includes("no high-risk flood overlap")) return "no_overlap";
    const m = detail.match(/(\d+)\s*→\s*(\d+)/);
    if (m && m[1] !== m[2]) return "excluded";
    if (m && m[1] === m[2]) return "no_overlap";
    return "unknown";
  }

  async function runAnalysis() {
    if (!scenario) return;
    const scenarioId = scenario.id;
    setTab("workspace");
    const steps = scenario.analysisPlan?.steps.length ?? 4;
    setAnalysisProgress(`Running analysis (0/${steps} steps)…`);
    try {
      await act("run_analysis", { scenarioId });
      setAnalysisProgress(null);
      setCriteriaStaleHint(false);
      setDrawerOpen(true);
      setTab("results");
    } catch {
      setAnalysisProgress(null);
    }
  }

  async function exportMapImage() {
    const container = document.querySelector(".leaflet-container") as HTMLElement | null;
    const { captureMapPng } = await import("@/components/PlanningMap");
    captureMapPng(container, `${workspace?.project.name ?? "map"}-workspace.png`);
    setToast("Map exported as PNG");
  }

  async function applyWeights() {
    if (!scenario || !weightDraft || weightSumRounded !== 100) return;
    setCriteriaStaleHint(true);
    await act("update_weights", { scenarioId: scenario.id, weights: weightDraft });
  }

  function scenarioStatusLabel(): string {
    if (runningJob) return runningJob.currentStep ?? "Analysis running…";
    if (isFreshResult && result) {
      return `Analysis complete — ${result.candidates.length} candidates`;
    }
    if (hasAnyResult && result && (result.stale || result.status === "stale")) {
      return `Results stale — ${result.candidates.length} candidates from last run (recalculate to apply changes)`;
    }
    return "No results yet — run analysis for this scenario";
  }

  function adjustWeightDraft(changedIndex: number, newPercent: number) {
    const base = weightDraft ?? scenario?.weights ?? [];
    setWeightDraft(rebalanceWeights(base, changedIndex, newPercent));
    setCriteriaStaleHint(true);
  }

  async function commitTransitThreshold(rawText: string) {
    if (!scenario) return;
    const parsed = Number(rawText.replace(/,/g, "").trim());
    if (!Number.isFinite(parsed)) {
      setTransitThresholdWarning("Enter a whole number of meters between 100 and 2000.");
      return;
    }
    const normalized = normalizeTransitThresholdMeters(parsed);
    setTransitThresholdWarning(normalized.warning ?? null);
    if (normalized.adjusted && normalized.warning) {
      setTransitDraftText((prev) => ({
        ...prev,
        [scenario.constraints.find((c) => c.operator === "within_distance")?.id ?? "transit"]:
          String(normalized.meters),
      }));
    }
    setCriteriaStaleHint(true);
    const constraints = scenario.constraints.map((c) =>
      c.operator === "within_distance"
        ? {
            ...c,
            value: normalized.meters,
            label: `Within ${normalized.meters}m of transit`,
          }
        : c
    );
    await act("update_constraints", { scenarioId: scenario.id, constraints });
    if (normalized.adjusted || normalized.warning) {
      setToast(normalized.warning ?? `Transit threshold set to ${normalized.meters}m`);
    }
  }

  function cancelDrawing() {
    setDrawMode("none");
    setDrawClicks([]);
    setEditingSelectionId(null);
    setShowFinishLabel(false);
    setFinishLabelDraft("");
  }

  function undoDrawVertex() {
    setDrawClicks((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }

  function startDraw(mode: "exclude" | "include") {
    setDrawMode(mode);
    setDrawClicks([]);
    setEditingSelectionId(null);
    setShowFinishLabel(false);
    setDrawerOpen(false);
  }

  function beginEditSelection(sel: GeographicSelection) {
    setDrawMode("edit");
    setEditingSelectionId(sel.id);
    setDrawClicks(ringFromPolygon(sel.geometry) as [number, number][]);
    setShowFinishLabel(false);
    setDrawerOpen(false);
  }

  async function finishDrawPolygon() {
    if (!scenario || drawClicks.length < 3) return;
    if (drawMode === "edit" && editingSelectionId) {
      await act("update_geo_selection", {
        scenarioId: scenario.id,
        selectionId: editingSelectionId,
        patch: { geometry: polygonFromRing(drawClicks) },
      });
      setCriteriaStaleHint(true);
      setToast("Geographic area updated — recalculate to apply.");
      cancelDrawing();
      return;
    }
    if (drawMode !== "exclude" && drawMode !== "include") return;
    const defaultLabel = uniqueGeographicLabel(
      scenario.geographicSelections,
      drawMode === "include" ? "inclusion" : "exclusion"
    );
    setFinishLabelDraft(defaultLabel);
    setShowFinishLabel(true);
  }

  async function confirmFinishPolygon() {
    if (!scenario || drawClicks.length < 3) return;
    if (drawMode !== "exclude" && drawMode !== "include") return;
    const label = uniqueGeographicLabel(
      scenario.geographicSelections,
      drawMode === "include" ? "inclusion" : "exclusion",
      finishLabelDraft
    );
    await act("add_geo_selection", {
      scenarioId: scenario.id,
      selection: {
        type: drawMode === "include" ? "inclusion" : "exclusion",
        label,
        geometry: polygonFromRing(drawClicks),
        createdBy: "human",
      },
    });
    setCriteriaStaleHint(true);
    setToast(`${drawMode === "include" ? "Inclusion" : "Exclusion"} "${label}" added — recalculate.`);
    cancelDrawing();
  }

  async function removeGeographicSelection(selectionId: string) {
    if (!scenario) return;
    const sel = scenario.geographicSelections.find((s) => s.id === selectionId);
    await act("remove_geo_selection", { scenarioId: scenario.id, selectionId });
    if (editingSelectionId === selectionId) cancelDrawing();
    setCriteriaStaleHint(true);
    setToast(
      sel
        ? `Removed "${sel.label}" — recalculate to restore excluded candidates.`
        : "Geographic area removed — recalculate."
    );
  }

  async function renameGeographicSelection(selectionId: string, label: string) {
    if (!scenario || !label.trim()) return;
    await act("update_geo_selection", {
      scenarioId: scenario.id,
      selectionId,
      patch: { label: label.trim() },
    });
    setRenamingExclusionId(null);
    setToast("Geographic area renamed.");
  }

  function geographicFunnelDetail(label: string): string | null {
    if (!result?.stepLogs) return null;
    const match = result.stepLogs.find((log) =>
      log.detail.includes(`"${label}"`)
    );
    return match?.detail ?? null;
  }

  async function duplicateScenario(name: string) {
    if (!scenario) return;
    await act("create_scenario", { name, fromScenarioId: scenario.id });
    setCriteriaStaleHint(true);
  }

  function promptDuplicateScenario() {
    if (!workspace || !scenario) return;
    const defaultName = `Branch ${workspace.scenarios.length + 1}`;
    const entered = window.prompt("Name for duplicated scenario:", defaultName);
    if (entered == null) return;
    const trimmed = entered.trim();
    if (trimmed.length < 2) {
      setToast("Scenario name must be at least 2 characters.");
      return;
    }
    void duplicateScenario(trimmed);
  }

  async function saveScenario() {
    if (!scenario) return;
    await act("save_scenario", { scenarioId: scenario.id });
    setToast(`Scenario "${scenario.name}" saved`);
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <div className="h-14 border-b border-outline-variant bg-surface-container-high px-section-padding flex items-center gap-4">
          <div className="h-5 w-48 bg-surface-variant rounded animate-pulse" />
        </div>
        <div className="flex-1 flex items-center justify-center text-body-sm text-on-surface-variant gap-3">
          <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
          Loading workspace…
        </div>
      </div>
    );
  }

  if (!workspace || !scenario) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <StorageBanner />
        <header className="bg-surface-container-high border-b border-outline-variant px-section-padding h-14 flex items-center">
          <Link href="/" className="font-display text-[18px] font-semibold text-primary">
            Urban Planning Copilot
          </Link>
        </header>
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg text-center border border-outline-variant bg-surface-container-lowest p-10">
            <h1 className="text-headline-md text-on-surface mb-3">This project is not available</h1>
            <p className="text-body-sm text-on-surface-variant mb-2">
              The server could not load project <span className="font-mono text-caption">{projectId}</span>.
              {error
                ? ` ${error}`
                : " It may have been removed or workspace storage may be degraded."}
            </p>
            <p className="text-body-sm text-on-surface-variant mb-6">
              If you were mid-analysis, check whether other projects are still listed on the home page.
              Storage issues show a banner at the top when the Render disk is unavailable.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => void refresh()}
                className="bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium"
              >
                Retry load
              </button>
              <Link
                href="/new"
                className="border border-outline-variant px-5 py-2.5 rounded text-body-sm"
              >
                New project
              </Link>
              <Link
                href="/"
                className="text-primary text-body-sm hover:underline py-2.5"
              >
                Back to projects
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeActivity = workspace.activities.find((a) => a.id === activityId);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background relative">
      <StorageBanner />
      <header className="bg-surface-container-high border-b border-outline-variant flex justify-between items-center px-section-padding h-14 shrink-0 z-50">
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/" className="font-display text-[18px] font-semibold text-primary shrink-0">
            Urban Planning Copilot
          </Link>
          <nav className="flex items-center gap-2 text-body-sm truncate">
            <Link href="/" className="text-on-surface-variant hover:text-primary">
              Projects
            </Link>
            <span className="text-outline-variant">/</span>
            <span className="truncate">{workspace.project.name}</span>
            <span className="text-outline-variant">/</span>
            <span className="text-primary font-medium truncate">Scenario: {scenario.name}</span>
          </nav>
        </div>
        <div className="flex items-center gap-1 text-primary">
          {(
            [
              ["workspace", "map"],
              ["results", "table_chart"],
              ["evidence", "database"],
              ["compare", "compare"],
              ["decision", "gavel"],
              ["activity", "history"],
              ["report", "description"],
            ] as const
          ).map(([t, icon]) => (
            <button
              key={t}
              type="button"
              title={TAB_LABELS[t]}
              aria-label={TAB_LABELS[t]}
              onClick={() => {
                setTab(t);
                if (t === "results") setDrawerOpen(true);
              }}
              className={`px-2 py-1.5 rounded transition-colors flex items-center gap-1 ${
                tab === t ? "bg-surface-variant" : "hover:bg-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">{icon}</span>
              <span className="hidden xl:inline text-caption">{TAB_LABELS[t]}</span>
            </button>
          ))}
          <button
            onClick={() => saveScenario()}
            className="px-2 py-1.5 hover:bg-surface-variant rounded text-caption flex items-center gap-1"
            title="Save scenario"
          >
            <span className="material-symbols-outlined text-[20px]">save</span>
            <span className="hidden xl:inline">Save</span>
          </button>
        </div>
      </header>

      {pendingPlannerActions.length > 0 && (
        <div className="bg-tertiary-fixed/20 border-b border-tertiary/30 px-section-padding py-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <ProvenanceChip kind="copilot_recommendation" />
                <span className="font-mono text-data-label uppercase text-tertiary">
                  Agent awaiting planner
                </span>
              </div>
              {pendingPlannerActions.map((pending) => (
                <div key={pending.id} className="text-body-sm">
                  <strong>{pending.title ?? pending.tool.replace(/_/g, " ")}</strong>
                  <span className="text-on-surface-variant"> — {pending.message}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                disabled={pendingBusy}
                onClick={async () => {
                  const pending = pendingPlannerActions[0];
                  if (!pending) return;
                  setPendingBusy(true);
                  try {
                    await resolvePendingPlannerAction(pending.id, projectId, true);
                    setToast(`Approved: ${pending.tool.replace(/_/g, " ")}`);
                    await refresh();
                  } catch (e) {
                    setToast(e instanceof Error ? e.message : String(e));
                  } finally {
                    setPendingBusy(false);
                  }
                }}
                className="bg-tertiary text-on-tertiary px-4 py-2 rounded text-body-sm font-medium disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={pendingBusy}
                onClick={async () => {
                  const pending = pendingPlannerActions[0];
                  if (!pending) return;
                  setPendingBusy(true);
                  try {
                    await resolvePendingPlannerAction(pending.id, projectId, false);
                    setToast("Agent action rejected");
                  } finally {
                    setPendingBusy(false);
                  }
                }}
                className="border border-outline-variant px-4 py-2 rounded text-body-sm"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {workspace.proposals.length > 0 && (
        <div className="bg-secondary-fixed/20 border-b border-secondary/30 px-section-padding py-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <ProvenanceChip kind="planner_decision" />
                <span className="font-mono text-data-label uppercase text-secondary">
                  Human review required
                </span>
              </div>
              {workspace.proposals.map((prop) => (
                <div key={prop.id} className="text-body-sm">
                  <strong>{prop.title}</strong>
                  {prop.description && prop.description !== prop.title ? (
                    <span className="text-on-surface-variant"> — {prop.description}</span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                disabled={busy}
                onClick={async () => {
                  const prop = workspace.proposals[0];
                  if (!prop) return;
                  await act("approve_proposal", { proposalId: prop.id });
                }}
                className="bg-secondary text-on-secondary px-4 py-2 rounded text-body-sm font-medium disabled:opacity-50"
              >
                Approve proposal
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  const prop = workspace.proposals[0];
                  if (!prop) return;
                  await act("reject_proposal", { proposalId: prop.id, reason: "Rejected in UI" });
                }}
                className="border border-outline-variant px-4 py-2 rounded text-body-sm"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-surface border-b border-outline-variant px-section-padding py-2 flex flex-wrap items-center gap-3 text-body-sm shrink-0">
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <span className="material-symbols-outlined text-outline text-[18px]">flag</span>
          <span className="text-on-surface-variant">Objective</span>
          <span className="text-outline-variant">·</span>
          <span className="font-medium truncate">
            {scenario.objective.targetValue
              ? `${scenario.objective.targetValue.toLocaleString()} ${scenario.objective.targetUnit ?? ""}`
              : scenario.objective.intent.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap min-w-0">
          {scenario.constraints
            .filter((c) => c.enabled)
            .slice(0, 4)
            .map((c) => (
            <span
              key={c.id}
              className="px-2 py-0.5 border border-outline rounded text-caption text-on-surface-variant whitespace-nowrap"
              title={c.hard ? "Hard constraint (engine-enforced)" : "Soft constraint"}
            >
              {c.label}
            </span>
          ))}
          {scenario.objective.excludesHousing && (
            <span className="px-2 py-0.5 border border-secondary rounded text-caption text-secondary whitespace-nowrap">
              Not a housing analysis
            </span>
          )}
          {scenario.objective.dataGaps?.map((gap) => (
            <span
              key={gap}
              className="px-2 py-0.5 border border-error rounded text-caption text-error whitespace-nowrap"
              title={gap}
            >
              Data gap
            </span>
          ))}
        </div>
        {result && housingTarget && totalCapacity != null && isHousingIntent(scenario.objective.intent) && (
          <div
            className={`shrink-0 px-3 py-1 rounded border text-caption font-medium whitespace-nowrap ${
              totalCapacity >= housingTarget
                ? "border-secondary bg-secondary-fixed/20 text-secondary"
                : "border-error bg-error-container/30 text-error"
            }`}
          >
            {totalCapacity >= housingTarget ? "Meets" : "Shortfall"}:{" "}
            {totalCapacity.toLocaleString()} / {housingTarget.toLocaleString()} homes
            {targetGap ? ` (${targetGap.method})` : ""}
          </div>
        )}
        {result && accessHeadline && !isHousingIntent(scenario.objective.intent) && (
          <div className="shrink-0 px-3 py-1 rounded border border-primary bg-primary-fixed/20 text-primary text-caption font-medium whitespace-nowrap">
            {accessHeadline.label}: {accessHeadline.value}
          </div>
        )}
        {!hasAnyResult && scenario && (
          <span className="shrink-0 text-caption text-on-surface-variant">
            {scenarioStatusLabel()}
          </span>
        )}
        {hasAnyResult && !isFreshResult && !runningJob && (
          <span className="shrink-0 text-caption text-on-surface-variant">
            {scenarioStatusLabel()}
          </span>
        )}
        {(result?.stale || criteriaStaleHint) && (
          <span className="shrink-0 px-3 py-1 rounded border border-secondary bg-secondary-fixed/20 text-secondary text-caption font-medium whitespace-nowrap">
            Results stale — recalculate
          </span>
        )}
        {scenario.decisionStatus === "approved" && scenario.decisionStale && (
          <span className="shrink-0 px-3 py-1 rounded border border-error bg-error-container/30 text-error text-caption font-medium whitespace-nowrap">
            Decision stale — re-approve required
          </span>
        )}
        {scenario.decisionStatus === "changes_requested" && (
          <span className="shrink-0 px-3 py-1 rounded border border-secondary bg-secondary-fixed/20 text-secondary text-caption font-medium whitespace-nowrap">
            Changes requested — address before approving
          </span>
        )}
        {workspace.project.resumeNote && !result?.stale && !criteriaStaleHint && (
          <span className="text-caption text-on-surface-variant truncate max-w-md ml-auto">
            {workspace.project.resumeNote}
          </span>
        )}
      </div>

      {error && (
        <div className="bg-error-container text-on-error-container px-4 py-2 text-body-sm">
          {error}
        </div>
      )}

      {isFreshResult && topCandidate && !runningJob && (tab === "workspace" || tab === "results") && (
        <div className="bg-primary-fixed/15 border-b border-primary-fixed/40 px-section-padding py-3 flex flex-wrap items-center gap-3 text-body-sm shrink-0">
          <span className="font-medium text-primary">
            Analysis complete — {result!.candidates.length} candidates. What&apos;s next?
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void selectCandidate(topCandidate, "evidence")}
              className="bg-primary text-on-primary px-3 py-1.5 rounded text-caption font-medium"
            >
              Inspect top site
            </button>
            {workspace.scenarios.length > 1 && (
              <button
                type="button"
                onClick={() => setTab("compare")}
                className="border border-primary text-primary px-3 py-1.5 rounded text-caption font-medium"
              >
                Compare scenarios
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab("decision")}
              className="border border-outline-variant px-3 py-1.5 rounded text-caption"
            >
              Record decision
            </button>
          </div>
        </div>
      )}

      {tab === "workspace" || tab === "results" ? (
        <main className="flex-1 flex overflow-hidden relative min-h-0">
          <aside className="w-sidebar-width bg-surface border-r border-outline-variant flex flex-col z-30 shrink-0 min-h-0">
            <div className="p-4 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
              <div>
                <h2 className="text-headline-md text-primary">Context</h2>
                <p className="text-caption text-on-surface-variant mt-0.5">
                  {workspace.project.geographyLabel}
                </p>
              </div>
              <span className="material-symbols-outlined text-outline">map</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
              <section>
                <div className="flex justify-between items-baseline mb-2">
                  <h3 className="font-mono text-data-label text-on-surface-variant uppercase">
                    Objective
                  </h3>
                </div>
                <p className="text-body-sm leading-relaxed">{scenario.objective.rawText}</p>
                <p className="text-caption text-on-surface-variant mt-2">
                  Intent: {scenario.objective.intent.replace(/_/g, " ")} · confidence{" "}
                  {Math.round(scenario.objective.confidence * 100)}%
                </p>
              </section>

              <section>
                <h3 className="font-mono text-data-label text-on-surface-variant uppercase mb-3">
                  Constraints
                </h3>
                <div className="space-y-3">
                  {scenario.constraints
                    .filter((c) => c.enabled)
                    .map((c) => {
                      const funnel = constraintFunnelDetail(c.label);
                      const isFlood = c.datasetKind === "flood";
                      const floodStatus = isFlood ? floodConstraintStatus() : null;
                      return (
                      <div key={c.id} className="flex items-start justify-between gap-2">
                        <span className="text-body-sm flex items-start gap-2">
                          <span
                            className={`material-symbols-outlined text-[18px] shrink-0 ${
                              isFlood && floodStatus === "no_overlap"
                                ? "text-on-surface-variant"
                                : "text-primary"
                            }`}
                          >
                            {isFlood && floodStatus === "no_overlap"
                              ? "info"
                              : "check_circle"}
                          </span>
                          <span>
                            {c.label}
                            {funnel && (
                              <span className="block text-caption text-on-surface-variant mt-0.5">
                                {funnel}
                              </span>
                            )}
                            {isFlood && floodStatus === "no_overlap" && (
                              <span className="block text-caption text-on-surface-variant mt-0.5">
                                No high-risk flood overlap in study area — constraint had no effect.
                              </span>
                            )}
                          </span>
                        </span>
                        {c.operator === "within_distance" && (
                          <label className="flex flex-col items-end gap-0.5 shrink-0 max-w-[11rem]">
                            <span className="sr-only">Transit proximity threshold in meters</span>
                            <span className="font-mono text-[10px] text-on-surface-variant uppercase">
                              Meters (100–2000)
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              aria-label="Transit proximity threshold in meters"
                              aria-describedby={
                                transitThresholdWarning ? "transit-threshold-warning" : undefined
                              }
                              className="w-20 font-mono text-data-label bg-primary-fixed px-1.5 py-0.5 rounded text-primary"
                              value={
                                transitDraftText[c.id] ??
                                String(Number(c.value))
                              }
                              onFocus={(e) => {
                                e.target.select();
                                setTransitDraftText((prev) => ({
                                  ...prev,
                                  [c.id]: String(Number(c.value)),
                                }));
                              }}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/[^\d]/g, "");
                                setTransitDraftText((prev) => ({ ...prev, [c.id]: digits }));
                                setTransitThresholdWarning(null);
                              }}
                              onBlur={(e) => {
                                void commitTransitThreshold(e.target.value);
                                setTransitDraftText((prev) => {
                                  const next = { ...prev };
                                  delete next[c.id];
                                  return next;
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void commitTransitThreshold(
                                    (e.target as HTMLInputElement).value
                                  );
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                            />
                            {transitThresholdWarning && (
                              <span
                                id="transit-threshold-warning"
                                className="text-[10px] text-secondary text-right leading-tight"
                                role="status"
                              >
                                {transitThresholdWarning}
                              </span>
                            )}
                          </label>
                        )}
                      </div>
                    );})}
                  {scenario.geographicSelections.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-outline-variant space-y-2">
                      <div className="font-mono text-[10px] uppercase text-on-surface-variant">
                        Geographic areas
                      </div>
                      {scenario.geographicSelections.map((g) => {
                        const funnel = geographicFunnelDetail(g.label);
                        return (
                          <div key={g.id} className="flex items-start justify-between gap-2">
                            <span className="text-body-sm flex items-start gap-2 min-w-0">
                              <span
                                className={`material-symbols-outlined text-[18px] shrink-0 ${
                                  g.type === "exclusion" ? "text-error" : "text-secondary"
                                }`}
                              >
                                {g.type === "exclusion" ? "block" : "crop_free"}
                              </span>
                              <span className="min-w-0">
                                {renamingExclusionId === g.id ? (
                                  <div className="flex gap-1">
                                    <input
                                      className="flex-1 border border-outline-variant rounded px-1 py-0.5 text-body-sm"
                                      value={exclusionLabelDraft}
                                      onChange={(e) => setExclusionLabelDraft(e.target.value)}
                                      aria-label="Geographic area name"
                                    />
                                    <button
                                      type="button"
                                      className="text-caption text-primary"
                                      onClick={() =>
                                        void renameGeographicSelection(g.id, exclusionLabelDraft)
                                      }
                                    >
                                      Save
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="font-medium">{g.label}</span>
                                    <span className="text-caption text-on-surface-variant ml-1">
                                      ({g.type})
                                    </span>
                                  </>
                                )}
                                {funnel && (
                                  <span className="block text-caption text-on-surface-variant mt-0.5">
                                    {funnel}
                                  </span>
                                )}
                              </span>
                            </span>
                            <div className="flex flex-col gap-1 shrink-0">
                              {renamingExclusionId !== g.id && (
                                <>
                                  <button
                                    type="button"
                                    className="text-caption text-primary hover:underline"
                                    onClick={() => beginEditSelection(g)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="text-caption text-primary hover:underline"
                                    onClick={() => {
                                      setRenamingExclusionId(g.id);
                                      setExclusionLabelDraft(g.label);
                                    }}
                                  >
                                    Rename
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="text-caption text-error hover:underline"
                                onClick={() => void removeGeographicSelection(g.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <div className="flex justify-between mb-3">
                  <h3 className="font-mono text-data-label text-on-surface-variant uppercase">
                    Priorities
                  </h3>
                  <button
                    onClick={applyWeights}
                    className="text-caption text-primary hover:underline"
                    disabled={busy || weightSumRounded !== 100}
                    title={weightSumRounded !== 100 ? "Priorities must sum to 100% before applying" : undefined}
                  >
                    Apply priorities
                  </button>
                </div>
                {weightSumRounded !== 100 && (
                  <p className="text-caption text-secondary mb-2" role="status">
                    Priorities sum to {weightSumRounded}% — adjust sliders (others rebalance automatically).
                  </p>
                )}
                <div className="space-y-4">
                  {(weightDraft ?? scenario.weights).map((w, i) => (
                    <div key={w.id}>
                      <div className="flex justify-between text-caption mb-1">
                        <label htmlFor={`weight-${w.id}`}>{w.label}</label>
                        <span>{Math.round(w.weight * 100)}%</span>
                      </div>
                      <input
                        id={`weight-${w.id}`}
                        type="range"
                        aria-label={`${w.label} priority`}
                        min={0}
                        max={100}
                        value={Math.round(w.weight * 100)}
                        onChange={(e) => adjustWeightDraft(i, Number(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="font-mono text-data-label text-on-surface-variant uppercase mb-3">
                  Layers
                </h3>
                <div className="space-y-2">
                  {workspace.datasets.map((d) => {
                    const vis = syncedMapLayers.find((l) => l.datasetId === d.id)?.visible;
                    const swatch = layerSwatch(d.kind);
                    return (
                      <label key={d.id} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(vis)}
                          onChange={async (e) => {
                            const layers = syncedMapLayers.map((l) =>
                              l.datasetId === d.id ? { ...l, visible: e.target.checked } : l
                            );
                            await act("update_map", { mapState: { layers } });
                          }}
                          className="rounded border-outline text-primary h-4 w-4"
                        />
                        <span
                          className={`w-3 h-3 shrink-0 ${swatch.className} ${
                            d.kind === "transit" || d.kind === "schools" ? "rounded-full" : ""
                          }`}
                          aria-hidden
                        />
                        <span className="text-body-sm">
                          {d.name.replace(" (Illustrative)", "").replace(" (Synthetic)", "")}
                          {d.stale ? " · outdated" : ""}
                          {!d.enabled ? " · disabled" : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="font-mono text-data-label text-on-surface-variant uppercase mb-3">
                  Scenarios
                </h3>
                <div className="space-y-2">
                  {workspace.scenarios.map((s) => {
                    const parent = s.parentScenarioId
                      ? workspace.scenarios.find((p) => p.id === s.parentScenarioId)
                      : null;
                    const scResult = workspace.analysisResults.find(
                      (r) => r.id === s.latestResultId
                    );
                    return (
                    <div key={s.id} className="space-y-1">
                      {renamingScenarioId === s.id ? (
                        <div className="flex gap-1">
                          <input
                            className="flex-1 border border-outline-variant rounded px-2 py-1 text-body-sm"
                            value={scenarioNameDraft}
                            onChange={(e) => setScenarioNameDraft(e.target.value)}
                            aria-label="Scenario name"
                          />
                          <button
                            type="button"
                            className="text-caption text-primary px-2"
                            onClick={async () => {
                              await act("rename_scenario", {
                                scenarioId: s.id,
                                name: scenarioNameDraft,
                              });
                              setRenamingScenarioId(null);
                            }}
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => act("activate_scenario", { scenarioId: s.id })}
                          className={`w-full text-left px-2 py-1.5 text-body-sm rounded border ${
                            s.id === scenario.id
                              ? "border-primary bg-primary-fixed/30"
                              : "border-outline-variant hover:bg-surface-container"
                          }`}
                        >
                          <span className="font-medium">{s.name}</span>
                          <span className="text-caption text-on-surface-variant ml-2">
                            · {s.status}
                          </span>
                          {scResult && (
                            <span className="block text-caption text-on-surface-variant mt-0.5">
                              {scResult.candidates.length} candidates
                              {scResult.stale ? " · stale" : ""}
                            </span>
                          )}
                          {parent && (
                            <span className="block text-caption text-on-surface-variant mt-0.5">
                              Duplicated from {parent.name}
                            </span>
                          )}
                        </button>
                      )}
                      {s.id === scenario.id && renamingScenarioId !== s.id && (
                        <button
                          type="button"
                          className="text-caption text-primary hover:underline"
                          onClick={() => {
                            setRenamingScenarioId(s.id);
                            setScenarioNameDraft(s.name);
                          }}
                        >
                          Rename scenario
                        </button>
                      )}
                    </div>
                  );})}
                  <button
                    onClick={() => promptDuplicateScenario()}
                    className="text-body-sm text-primary hover:underline"
                  >
                    + Duplicate scenario
                  </button>
                </div>
              </section>
            </div>
            <div className="p-4 border-t border-outline-variant text-center">
              <button
                onClick={() => setTab("evidence")}
                className="text-caption text-primary hover:underline inline-flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">info</span>
                Data &amp; assumptions
              </button>
            </div>
          </aside>

          <section className="flex-1 relative bg-surface-container-low">
            <PlanningMap
              workspace={workspace}
              layerData={layerData}
              candidates={candidates}
              onSelectCandidate={(c) => {
                if (drawingActive) return;
                void selectCandidate(c, "evidence");
              }}
              drawMode={drawMode}
              drawClicks={drawClicks}
              editingSelectionId={editingSelectionId}
              stale={Boolean(result?.stale)}
              onMapClickDraw={({ lat, lng }) => {
                setDrawClicks((prev) => [...prev, [lng, lat]]);
              }}
              onVertexDrag={(index, lat, lng) => {
                setDrawClicks((prev) => {
                  const next = [...prev];
                  next[index] = [lng, lat];
                  return next;
                });
              }}
              onSelectGeographic={(sel) => {
                if (drawMode === "none") beginEditSelection(sel);
              }}
            />

            <div
              className="absolute right-4 top-4 flex flex-col gap-2 z-[1000]"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  if (drawMode === "exclude") cancelDrawing();
                  else startDraw("exclude");
                }}
                className={`glass-panel p-2 rounded border border-outline-variant pointer-events-auto ${
                  drawMode === "exclude" ? "bg-error-container" : ""
                }`}
                title="Draw exclusion polygon"
                aria-label="Draw exclusion polygon"
                aria-pressed={drawMode === "exclude"}
              >
                <span className="material-symbols-outlined">block</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (drawMode === "include") cancelDrawing();
                  else startDraw("include");
                }}
                className={`glass-panel p-2 rounded border border-outline-variant pointer-events-auto ${
                  drawMode === "include" ? "bg-secondary-fixed/40" : ""
                }`}
                title="Draw inclusion polygon (restrict analysis to area)"
                aria-label="Draw inclusion polygon"
                aria-pressed={drawMode === "include"}
              >
                <span className="material-symbols-outlined">crop_free</span>
              </button>
              {drawingActive && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void finishDrawPolygon();
                    }}
                    disabled={drawClicks.length < 3}
                    className="glass-panel px-2 py-1 rounded border border-outline-variant text-caption disabled:opacity-40 pointer-events-auto"
                  >
                    {drawMode === "edit" ? "Save" : "Finish"} ({drawClicks.length})
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      undoDrawVertex();
                    }}
                    disabled={drawClicks.length === 0}
                    className="glass-panel px-2 py-1 rounded border border-outline-variant text-caption disabled:opacity-40 pointer-events-auto"
                    title="Undo last vertex (Backspace)"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelDrawing();
                    }}
                    className="glass-panel px-2 py-1 rounded border border-outline-variant text-caption pointer-events-auto"
                    title="Cancel drawing (Escape)"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {showFinishLabel && (
              <div
                className="absolute right-4 top-48 z-[1002] glass-panel p-3 rounded border border-outline-variant w-56 pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <label className="block text-caption text-on-surface-variant mb-1">
                  Area name
                </label>
                <input
                  className="w-full border border-outline-variant rounded px-2 py-1 text-body-sm mb-2"
                  value={finishLabelDraft}
                  onChange={(e) => setFinishLabelDraft(e.target.value)}
                  aria-label="Geographic area name"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 bg-primary text-on-primary px-2 py-1 rounded text-caption"
                    onClick={() => void confirmFinishPolygon()}
                  >
                    Add area
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded text-caption border border-outline-variant"
                    onClick={() => setShowFinishLabel(false)}
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            <div
              className={`absolute bottom-20 right-4 z-[1001] max-w-[200px] ${
                drawingActive ? "pointer-events-none" : "pointer-events-auto"
              }`}
            >
              <button
                type="button"
                onClick={() => setLegendOpen((v) => !v)}
                className="glass-panel px-2.5 py-1 rounded border border-outline-variant text-[10px] font-mono uppercase text-on-surface-variant flex items-center gap-1.5 w-full pointer-events-auto"
                aria-expanded={legendOpen}
              >
                <span className="material-symbols-outlined text-[14px]">legend</span>
                Legend {legendOpen ? "▾" : "▸"}
              </button>
              {legendOpen && (
                <div className="glass-panel p-2 rounded border border-outline-variant mt-1 pointer-events-auto max-h-48 overflow-y-auto">
                  <MapLegend
                    compact
                    visibleKinds={visibleLayerKinds}
                    hasExclusions={scenario.geographicSelections.some(
                      (g) => g.type === "exclusion"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setLegendDocked((v) => !v)}
                    className="mt-2 text-[10px] text-primary hover:underline"
                  >
                    {legendDocked ? "Float legend" : "Dock legend"}
                  </button>
                </div>
              )}
            </div>

            <div className="absolute top-16 right-4 z-[1000] pointer-events-auto">
              <button
                type="button"
                onClick={() => void exportMapImage()}
                className="glass-panel px-2.5 py-1 rounded border border-outline-variant text-[10px] font-mono uppercase text-on-surface-variant"
                title="Export map as PNG"
              >
                Export PNG
              </button>
            </div>

            <div
              className={`absolute bottom-0 left-1/2 -translate-x-1/2 z-[1001] ${
                drawingActive ? "pointer-events-none" : "pointer-events-auto"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen((open) => !open);
                  setTab("results");
                }}
                className="bg-surface border-t border-l border-r border-outline-variant rounded-t-xl px-6 py-1 flex flex-col items-center hover:bg-surface-container-low"
              >
                <div className="w-8 h-1 bg-outline-variant rounded-full mb-1" />
                <span className="font-mono text-data-label text-on-surface-variant">
                  Analysis results ({candidates.length})
                </span>
              </button>
            </div>
          </section>

          <aside
            id="agent-activity-panel"
            className="w-inspector-width bg-surface border-l border-outline-variant flex flex-col z-30 shrink-0 min-h-0"
          >
            <div className="p-4 border-b border-outline-variant bg-surface-container-low flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-headline-md text-primary-container">Agent activity</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      runningJob ? "bg-primary animate-pulse" : result ? "bg-primary-container" : "bg-outline"
                    }`}
                  />
                  <p className="text-caption text-on-surface-variant">
                    {scenarioStatusLabel()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                title="Jump to agent activity"
                aria-label="Jump to agent activity"
                onClick={() =>
                  document
                    .getElementById("agent-activity-panel")
                    ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                }
                className="material-symbols-outlined text-primary hover:text-primary-container transition-colors"
              >
                smart_toy
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
              {!result && scenario.analysisPlan && (
                <>
                  <div className="bg-primary-fixed/20 p-3 rounded-r-lg rounded-bl-lg border border-primary-fixed">
                    <p className="text-body-sm">
                      I&apos;ve translated your planning question into an analysis plan. Review
                      it before I run the analysis.
                    </p>
                  </div>
                  <div>
                    <div className="flex justify-between items-end mb-4">
                      <h3 className="font-mono text-data-label text-on-surface-variant uppercase">
                        Structured Analysis Plan
                      </h3>
                      <span className="text-caption text-outline">
                        {scenario.analysisPlan.steps.length} steps
                      </span>
                    </div>
                    <div className="space-y-0 relative ml-2">
                      {scenario.analysisPlan.steps.map((step) => (
                        <div key={step.id} className="logic-line flex gap-4 pb-4">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] shrink-0 z-10 border ${
                              step.status === "completed"
                                ? "bg-primary text-on-primary border-primary"
                                : "bg-surface-variant text-on-surface border-outline-variant"
                            }`}
                          >
                            {step.order}
                          </div>
                          <div className="flex-1">
                            <p className="text-body-sm font-medium mb-1">{step.label}</p>
                            <p className="text-caption text-on-surface-variant mb-1">
                              {step.purpose}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {step.datasets.map((d) => (
                                <DatasetRefChip
                                  key={d}
                                  label={d}
                                  datasets={workspace.datasets}
                                  onInspect={(id) => openDatasetInspect(id)}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {(result || runningJob) && (
                <div>
                  <h3 className="font-mono text-data-label text-on-surface-variant uppercase mb-3 border-b border-outline-variant pb-2">
                    Agent activity
                  </h3>
                  <div className="space-y-3">
                    {workspace.activities
                      .filter((a) => a.scenarioId === scenario.id && a.actor === "agent")
                      .slice(0, 8)
                      .map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            setActivityId(a.id);
                            setTab("activity");
                          }}
                          className="w-full text-left"
                        >
                          <div className="font-mono text-[10px] text-on-surface-variant mb-0.5">
                            {formatLocaleDateTime(a.timestamp)}
                          </div>
                          <div className="text-body-sm">{a.summary}</div>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {result && (
                <div className="border border-outline-variant rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-data-label uppercase">Status</span>
                    <ProvenanceChip
                      kind={
                        result.stale
                          ? "calculated"
                          : result.status === "failed"
                            ? "calculated"
                            : "calculated"
                      }
                    />
                  </div>
                  <p className="text-body-sm">{result.summary}</p>
                  {result.stale && (
                    <p className="text-caption text-secondary">
                      {result.staleReason ?? "Inputs changed since this result."}
                    </p>
                  )}
                  {result.candidates[0] && topCandidate && topCandidate.status !== "rejected" && (
                    <div className="bg-primary-container/10 border border-primary-fixed p-2 rounded">
                      <ProvenanceChip kind="copilot_recommendation" />
                      <p className="text-body-sm mt-2">
                        Top candidate: <strong>{topCandidate.label}</strong> (score{" "}
                        {topCandidate.score.toFixed(1)})
                      </p>
                      <p className="text-caption text-on-surface-variant mt-1">
                        Recommendation only — not a planning decision.
                      </p>
                    </div>
                  )}
                  {selectedCandidate && (
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerOpen(true);
                        setDrawerPanel("evidence");
                        setTab("results");
                      }}
                      className="text-caption text-primary hover:underline"
                    >
                      Why this candidate?
                    </button>
                  )}
                </div>
              )}
            </div>

            {assumptionsOpen && (
              <div className="shrink-0 border-t border-outline-variant bg-surface-container-low p-4 max-h-[40vh] overflow-y-auto">
                <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-3">
                  Analysis assumptions
                </h3>
                <p className="text-caption text-on-surface-variant mb-3">
                  Editing assumptions marks results stale until you recalculate.
                </p>
                <div className="space-y-3">
                  {scenario.assumptions.map((a, i) => (
                    <label key={a.id} className="block text-body-sm">
                      <span className="text-on-surface-variant">{a.label}</span>
                      <input
                        disabled={!a.editable}
                        className="ml-2 border-b border-outline bg-transparent font-mono w-24"
                        value={String(a.value)}
                        onChange={async (e) => {
                          const next = [...scenario.assumptions];
                          const raw = e.target.value;
                          next[i] = {
                            ...a,
                            value: Number.isFinite(Number(raw)) ? Number(raw) : raw,
                          };
                          await act("update_assumptions", {
                            scenarioId: scenario.id,
                            assumptions: next,
                          });
                        }}
                      />
                      {a.unit && <span className="text-caption ml-1">{a.unit}</span>}
                      <p className="text-caption text-on-surface-variant">{a.description}</p>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 border-t border-outline-variant bg-surface-container-lowest flex flex-col gap-3 shrink-0">
              <div className="font-mono text-[11px] text-on-surface-variant flex justify-center gap-2">
                <span>{enabledDatasetCount} DATASETS</span>·
                <span>
                  {scenario.constraints.filter((c) => c.enabled).length} CONSTRAINTS
                </span>
                ·
                <span>{scenario.analysisPlan?.steps.length ?? 0} ANALYSES</span>
              </div>
              <button
                onClick={runAnalysis}
                disabled={busy}
                className="w-full bg-primary hover:bg-on-primary-fixed-variant text-on-primary font-medium py-2 px-4 rounded flex justify-center items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                {busy && analysisProgress ? "Running…" : result ? "Recalculate" : "Run analysis"}
              </button>
              {(busy || analysisProgress || runningJob) && (
                <p className="text-caption text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-[14px] text-primary">
                    progress_activity
                  </span>
                  {analysisProgress ??
                    runningJob?.currentStep ??
                    "Analysis in progress — typically 5–15s for demo datasets"}
                  {scenario.analysisPlan && (
                    <span className="block text-[10px] text-outline">
                      ETA ~{Math.max(3, scenario.analysisPlan.steps.length * 2)}s
                    </span>
                  )}
                </p>
              )}
              <button
                type="button"
                onClick={() => setAssumptionsOpen((v) => !v)}
                className={`w-full border py-2 px-4 rounded text-body-sm ${
                  assumptionsOpen
                    ? "border-primary bg-primary-fixed/20 text-primary"
                    : "border-outline-variant"
                }`}
              >
                {assumptionsOpen ? "Hide assumptions" : "Review assumptions"}
              </button>
            </div>
          </aside>
        </main>
      ) : null}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-inverse-surface text-inverse-on-surface px-4 py-2 rounded shadow-lg text-body-sm">
          {toast}
        </div>
      )}

      {drawerOpen && (tab === "workspace" || tab === "results") ? (
        <ResultsDrawer
          open={drawerOpen}
          panel={drawerPanel}
          onPanelChange={setDrawerPanel}
          onClose={() => setDrawerOpen(false)}
          drawingActive={drawingActive}
          result={result}
          stale={Boolean(result?.stale)}
          selected={selectedCandidate}
          datasets={workspace.datasets}
          onInspectDataset={(datasetId) => openDatasetInspect(datasetId)}
          floodCoverageWarning={floodCoverageWarning}
          housingTarget={housingTarget}
          totalCapacity={totalCapacity}
          intent={scenario.objective.intent}
          resultsColumns={resultsColumns}
          accessHeadline={accessHeadline}
          selectionUpdated={selectionUpdated}
          onDismissUpdated={() => setSelectionUpdated(false)}
          focusedRowIndex={focusedRowIndex}
          setFocusedRowIndex={setFocusedRowIndex}
          resultLimitations={result?.limitations ?? []}
          topCandidateId={topCandidate?.id}
          onSelect={(c) => selectCandidate(c, "evidence")}
          onReject={async (c, reason) => {
            await act("record_decision", {
              scenarioId: scenario.id,
              type: "reject_candidate",
              subjectId: c.id,
              reason,
            });
            await refresh();
          }}
        />
      ) : null}

      {tab === "evidence" && (
        <EvidenceView
          workspace={workspace}
          scenarioId={scenario.id}
          onInspect={(datasetId) => openDatasetInspect(datasetId)}
          onShowOnMap={async (datasetId) => {
            const layers = syncedMapLayers.map((l) => ({
              ...l,
              visible: l.datasetId === datasetId ? true : l.visible,
            }));
            await act("update_map", {
              mapState: { layers, focusDatasetId: datasetId },
            });
            setTab("workspace");
          }}
        />
      )}
      {tab === "compare" && (
        <CompareView
          workspace={workspace}
          compareIds={compareIds}
          setCompareIds={setCompareIds}
          comparison={comparison}
          insights={compareInsights}
          busy={compareBusy}
          error={compareError}
          hint={compareHint}
          onHint={setCompareHint}
          onCompare={async () => {
            const ids = [...compareIds];
            if (ids.length < 2) return;
            setCompareBusy(true);
            setCompareError(null);
            try {
              const data = await act("compare_scenarios", { scenarioIds: ids });
              if (data.status === "incomplete") {
                setComparison(null);
                setCompareInsights(null);
                setCompareHint(data.message ?? "Run analysis first for selected scenarios.");
              } else {
                setComparison(data.comparison ?? null);
                setCompareInsights(data.insights ?? null);
                setCompareHint(null);
              }
              setCompareIds(ids);
            } catch (e) {
              setCompareError(e instanceof Error ? e.message : "Compare failed");
            } finally {
              setCompareBusy(false);
            }
          }}
          onPrefer={async (id) => {
            await act("record_decision", {
              scenarioId: id,
              type: "prefer_scenario",
            });
            await act("activate_scenario", { scenarioId: id });
          }}
        />
      )}
      {tab === "decision" && (
        <DecisionView
          workspace={workspace}
          scenario={scenario}
          result={result}
          topCandidate={topCandidate}
          layerData={layerData}
          reason={decisionReason}
          setReason={(v) => {
            if (!scenario) return;
            setDecisionReasonByScenario((prev) => ({ ...prev, [scenario.id]: v }));
            setDecisionError(null);
          }}
          error={decisionError}
          confirmType={confirmDecision}
          onRequestConfirm={setConfirmDecision}
          onCancelConfirm={() => setConfirmDecision(null)}
          onDecide={async (type) => {
            setDecisionError(null);
            try {
              await act("record_decision", {
                scenarioId: scenario.id,
                type,
                reason: decisionReason.trim() || undefined,
              });
              setConfirmDecision(null);
              setToast(`Decision recorded: ${formatDecisionType(type)}`);
            } catch (e) {
              setDecisionError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
      {tab === "activity" && (
        <ActivityView
          workspace={workspace}
          selected={activeActivity}
          onSelect={setActivityId}
        />
      )}
      {tab === "report" && (
        <ReportView
          workspace={workspace}
          scenario={scenario}
          result={result}
          selectedReportId={reportId}
          onSelectReport={setReportId}
          onDownload={(message) => setToast(message)}
          onGenerate={async () => {
            const data = await act("generate_report", {
              scenarioIds: [scenario.id],
              title: `${workspace.project.name} — ${scenario.name} Planning Report`,
            });
            setReportId(data.reportId);
            await refresh();
          }}
          generating={busy}
        />
      )}
      {inspectDatasetId && workspace && (() => {
        const inspectDataset = workspace.datasets.find((d) => d.id === inspectDatasetId);
        if (!inspectDataset) return null;
        return (
        <DatasetInspectPanel
          dataset={inspectDataset}
          enabledForScenario={scenario.enabledDatasetIds.includes(inspectDatasetId)}
          onClose={() => setInspectDatasetId(null)}
          onShowOnMap={async () => {
            const layers = syncedMapLayers.map((l) => ({
              ...l,
              visible: l.datasetId === inspectDatasetId ? true : l.visible,
            }));
            await act("update_map", {
              mapState: { layers, focusDatasetId: inspectDatasetId },
            });
            setInspectDatasetId(null);
            setTab("workspace");
          }}
        />
        );
      })()}
    </div>
  );
}

function ResultsDrawer(props: {
  open: boolean;
  panel: DrawerPanel;
  onPanelChange: (panel: DrawerPanel) => void;
  onClose: () => void;
  drawingActive?: boolean;
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  stale: boolean;
  selected: Candidate | null;
  topCandidateId?: string;
  housingTarget?: number;
  totalCapacity?: number;
  intent: PlanningIntent;
  resultsColumns: ResultsColumn[];
  accessHeadline?: { label: string; value: string } | null;
  selectionUpdated?: boolean;
  onDismissUpdated?: () => void;
  focusedRowIndex: number;
  setFocusedRowIndex: (index: number) => void;
  resultLimitations: string[];
  datasets: DatasetMeta[];
  onInspectDataset: (datasetId: string) => void;
  floodCoverageWarning?: string | null;
  onSelect: (c: Candidate) => void;
  onReject: (c: Candidate, reason: string) => Promise<void>;
}) {
  const { result, selected, panel, intent } = props;
  if (!props.open) return null;

  const showEvidence = panel === "evidence" || Boolean(selected);
  const visibleCandidates = result?.candidates.slice(0, 40) ?? [];
  const housingAnalysis = isHousingIntent(intent);
  const evidenceMetrics = selected
    ? evidenceMetricsForCandidate(selected, intent)
    : [];
  const limitationText = dedupeLimitations(
    props.resultLimitations.length > 0
      ? props.resultLimitations
      : selected?.provenance.limitations ?? []
  ).join("; ") || "None noted";

  return (
    <div
      className={`absolute bottom-0 left-[300px] right-[360px] max-h-[42vh] z-[35] ${
        props.drawingActive ? "pointer-events-none" : "pointer-events-none"
      }`}
    >
      <div
        className={`max-h-[42vh] bg-surface border-t border-outline-variant flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.06)] ${
          props.drawingActive ? "pointer-events-none" : "pointer-events-auto"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant bg-surface-container-low shrink-0">
          <div className="flex gap-4 items-center min-w-0">
            <button
              type="button"
              onClick={() => props.onPanelChange("candidates")}
              className={`font-mono text-data-label pb-1 ${
                panel === "candidates"
                  ? "text-primary border-b-2 border-primary"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              Candidates
            </button>
            <button
              type="button"
              onClick={() => props.onPanelChange("evidence")}
              className={`font-mono text-data-label pb-1 ${
                panel === "evidence"
                  ? "text-primary border-b-2 border-primary"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              Evidence
            </button>
            {props.housingTarget != null && props.totalCapacity != null && housingAnalysis && (
              <span
                className={`hidden md:inline font-mono text-[10px] uppercase px-2 py-0.5 rounded border whitespace-nowrap ${
                  props.totalCapacity >= props.housingTarget
                    ? "border-secondary text-secondary"
                    : "border-error text-error"
                }`}
              >
                {props.totalCapacity >= props.housingTarget ? "Meets" : "Shortfall"}{" "}
                {props.totalCapacity.toLocaleString()} / {props.housingTarget.toLocaleString()} homes
              </span>
            )}
            {props.accessHeadline && !housingAnalysis && (
              <span className="hidden md:inline font-mono text-[10px] uppercase px-2 py-0.5 rounded border border-primary text-primary whitespace-nowrap">
                {props.accessHeadline.label}: {props.accessHeadline.value}
              </span>
            )}
            {props.stale && (
              <span className="text-caption text-secondary font-medium whitespace-nowrap">
                Stale — recalculate
              </span>
            )}
            {props.selectionUpdated && (
              <span className="text-caption text-primary font-medium whitespace-nowrap">
                Selection updated for new results
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={props.onDismissUpdated}
                >
                  Dismiss
                </button>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="p-1 hover:bg-surface-variant rounded"
            aria-label="Close results panel"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden grid md:grid-cols-2 gap-px bg-outline-variant">
          <div
            className={`bg-surface p-4 overflow-auto min-h-0 ${panel === "evidence" ? "hidden md:block" : ""}`}
          >
            {props.floodCoverageWarning && (
              <div
                role="alert"
                className="mb-3 border border-secondary/50 bg-secondary-fixed/15 text-secondary text-caption px-3 py-2 rounded"
              >
                {props.floodCoverageWarning}
              </div>
            )}
            {!result ? (
              <p className="text-body-sm text-on-surface-variant">No results yet.</p>
            ) : result.status === "failed" ? (
              <p className="text-body-sm text-error">{result.error}</p>
            ) : result.candidates.length === 0 ? (
              <div>
                <p className="text-body-sm font-medium mb-2">No feasible candidates found.</p>
                <p className="text-caption text-on-surface-variant">{result.summary}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body-sm min-w-[620px]">
                  <thead>
                    <tr className="font-mono text-data-label text-on-surface-variant">
                      {props.resultsColumns.map((col) => (
                        <th key={col.key} className="py-2 pr-2">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCandidates.map((c, rowIndex) => (
                      <tr
                        key={c.id}
                        tabIndex={props.focusedRowIndex === rowIndex ? 0 : -1}
                        ref={(el) => {
                          if (props.focusedRowIndex === rowIndex && el) el.focus();
                        }}
                        role="button"
                        aria-label={`Select candidate ${c.label}, rank ${c.rank}`}
                        onClick={() => {
                          props.setFocusedRowIndex(rowIndex);
                          props.onDismissUpdated?.();
                          props.onSelect(c);
                          props.onPanelChange("evidence");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            const next = Math.min(rowIndex + 1, visibleCandidates.length - 1);
                            props.setFocusedRowIndex(next);
                            const nextC = visibleCandidates[next];
                            if (nextC) {
                              props.onDismissUpdated?.();
                              props.onSelect(nextC);
                              props.onPanelChange("evidence");
                            }
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            const prev = Math.max(rowIndex - 1, 0);
                            props.setFocusedRowIndex(prev);
                            const prevC = visibleCandidates[prev];
                            if (prevC) {
                              props.onDismissUpdated?.();
                              props.onSelect(prevC);
                              props.onPanelChange("evidence");
                            }
                          } else if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            props.onDismissUpdated?.();
                            props.onSelect(c);
                            props.onPanelChange("evidence");
                          }
                        }}
                        className={`border-t border-outline-variant cursor-pointer hover:bg-surface-container-low outline-none focus:ring-2 focus:ring-primary/40 ${
                          selected?.id === c.id ? "bg-primary-fixed/25" : ""
                        } ${props.stale ? "opacity-60" : ""}`}
                      >
                        {props.resultsColumns.map((col) => (
                          <td key={col.key} className="py-2 pr-2 font-mono">
                            {col.format(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {result.aggregateMetrics
                  .filter(
                    (m) =>
                      m.key !== "housing_target_gap" &&
                      !(m.key === "total_capacity" && !housingAnalysis)
                  )
                  .map((m) => (
                    <div
                      key={m.key}
                      className={`border border-outline-variant p-3 ${props.stale ? "opacity-60" : ""}`}
                    >
                      <div className="font-mono text-[10px] text-on-surface-variant uppercase mb-1">
                        {m.label}
                      </div>
                      <div className="text-headline-md font-mono">
                        {m.value.toLocaleString()}
                        {m.unit ? ` ${m.unit}` : ""}
                      </div>
                      <ProvenanceChip kind={m.kind} />
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div
            className={`bg-surface p-4 overflow-auto min-h-0 ${panel === "candidates" ? "hidden md:block" : ""}`}
          >
            {!showEvidence || !selected ? (
              <p className="text-body-sm text-on-surface-variant">
                Select a candidate to inspect evidence.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-headline-md mb-1">{selected.label}</h3>
                  <div className="flex gap-2 items-center flex-wrap">
                    {props.topCandidateId === selected.id && (
                      <ProvenanceChip kind="copilot_recommendation" />
                    )}
                    <span className="font-mono text-data-label">Score {selected.score.toFixed(1)}</span>
                    {props.housingTarget != null && housingAnalysis && (
                      <span className="text-caption text-on-surface-variant">
                        Capacity{" "}
                        {selected.metrics.find((m) => m.key === "capacity")?.value ?? "—"} vs goal{" "}
                        {props.housingTarget.toLocaleString()} homes
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="font-mono text-data-label uppercase mb-2">Score breakdown</h4>
                  <ul className="text-body-sm space-y-1">
                    {Object.entries(selected.provenance.scoreBreakdown).map(([k, v]) => (
                      <li key={k} className="flex justify-between gap-4">
                        <span className="text-on-surface-variant">
                          {k.replace(/_/g, " ")} (weighted contribution)
                        </span>
                        <span className="font-mono">{v}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-4 font-medium border-t border-outline-variant pt-1">
                      <span>Total score</span>
                      <span className="font-mono">{selected.score.toFixed(1)}</span>
                    </li>
                  </ul>
                  <p className="text-caption text-on-surface-variant mt-2">
                    {housingAnalysis
                      ? "Ranking uses weighted criteria — higher capacity alone does not guarantee rank #1."
                      : "Ranking prioritizes population with poor service access, not farthest distance alone."}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {evidenceMetrics.map((m) => (
                    <div key={m.key} className="border border-outline-variant p-2">
                      <div className="font-mono text-[10px] uppercase text-on-surface-variant">
                        {m.label}
                      </div>
                      <div className="font-mono text-body-sm mt-1">
                        {m.value}
                        {m.unit ? ` ${m.unit}` : ""}
                      </div>
                      <ProvenanceChip kind={m.kind} />
                      {m.method && (
                        <p className="text-caption text-on-surface-variant mt-1">{m.method}</p>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="font-mono text-data-label uppercase mb-2">Provenance</h4>
                  <ul className="text-caption space-y-1 text-on-surface-variant">
                    <li className="flex flex-wrap items-center gap-1">
                      <span>Datasets:</span>
                      {selected.provenance.datasets.length > 0
                        ? selected.provenance.datasets.map((id) => (
                            <DatasetRefChip
                              key={id}
                              label={id}
                              datasets={props.datasets}
                              onInspect={props.onInspectDataset}
                            />
                          ))
                        : "—"}
                    </li>
                    <li>Assumptions: {selected.provenance.assumptions.join(", ")}</li>
                    <li>Constraints: {selected.provenance.constraints.join("; ")}</li>
                    <li>Limitations: {limitationText}</li>
                  </ul>
                </div>
                {selected.recommendationNote && (
                  <p className="text-body-sm text-on-surface-variant border-l-2 border-primary pl-3">
                    {selected.recommendationNote}
                  </p>
                )}
                {selected.status !== "rejected" && (
                  <button
                    type="button"
                    onClick={() =>
                      props.onReject(selected, "Planned redevelopment already exists here.")
                    }
                    className="border border-error text-error px-3 py-1.5 rounded text-body-sm"
                  >
                    Reject candidate
                  </button>
                )}
                {selected.rejectionReason && (
                  <p className="text-body-sm text-secondary">
                    <ProvenanceChip kind="planner_decision" /> Rejected: {selected.rejectionReason}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DatasetRefChip({
  label,
  datasets,
  onInspect,
}: {
  label: string;
  datasets: DatasetMeta[];
  onInspect?: (datasetId: string) => void;
}) {
  const match =
    datasets.find((d) => d.id === label || d.name === label || d.kind === label) ??
    datasets.find(
      (d) =>
        d.name.toLowerCase().includes(label.toLowerCase()) ||
        label.toLowerCase().includes(d.kind)
    );
  if (!match) {
    return (
      <span className="px-1.5 py-0.5 bg-surface-container border border-outline-variant font-mono text-[10px]">
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onInspect?.(match.id)}
      className="px-1.5 py-0.5 bg-surface-container border border-outline-variant font-mono text-[10px] hover:border-primary text-primary"
      title={`Inspect ${match.name}`}
    >
      {match.id}
    </button>
  );
}

function EvidenceView({
  workspace,
  scenarioId,
  onShowOnMap,
  onInspect,
}: {
  workspace: WorkspaceSnapshot;
  scenarioId: string;
  onShowOnMap: (datasetId: string) => Promise<void>;
  onInspect: (datasetId: string) => void;
}) {
  const scenario = workspace.scenarios.find((s) => s.id === scenarioId)!;
  const focusId = workspace.project.mapState.focusDatasetId;
  return (
    <main className="flex-1 overflow-auto p-8">
      <h2 className="text-display mb-2">Evidence &amp; Data</h2>
      <p className="text-body-sm text-on-surface-variant mb-2">
        Source datasets, versions, coverage, and limitations for this workspace.
      </p>
      <p className="text-caption text-on-surface-variant mb-6">
        Dataset enable/disable and outdated flags on the{" "}
        <Link href="/data" className="text-primary hover:underline">
          global Data catalog
        </Link>{" "}
        apply to all workspaces — changes appear here immediately.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        {workspace.datasets.map((d) => {
          const enabledForScenario = scenario.enabledDatasetIds.includes(d.id);
          return (
          <div
            key={d.id}
            id={`dataset-${d.id}`}
            className={`border bg-surface-container-lowest p-4 ${
              focusId === d.id ? "border-primary" : "border-outline-variant"
            }`}
          >
            <div className="flex justify-between gap-2 mb-2">
              <h3 className="text-headline-md">{d.name}</h3>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onInspect(d.id)}
                  className="text-caption text-primary hover:underline"
                >
                  Inspect
                </button>
                <button
                  type="button"
                  onClick={() => void onShowOnMap(d.id)}
                  className="text-caption text-primary hover:underline"
                >
                  Show on map
                </button>
              </div>
            </div>
            <div className="mb-2">
              <DatasetRefChip label={d.id} datasets={workspace.datasets} />
              <span className="ml-2">
                <ProvenanceChip kind="source_data" />
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-body-sm">
              <div>
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Source</dt>
                <dd>{d.source}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Version</dt>
                <dd className="font-mono">{d.version}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Data vintage</dt>
                <dd>{d.dataVintage ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Catalog synced</dt>
                <dd>{formatLocaleDateTime(d.updatedAt)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Coverage</dt>
                <dd>{d.coverage}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Scenario</dt>
                <dd>{enabledForScenario ? "Enabled" : "Not enabled"}</dd>
              </div>
            </dl>
            {d.synthetic && (
              <p className="mt-2 text-caption text-secondary">Synthetic seed data — not authoritative.</p>
            )}
            {d.stale && (
              <p className="mt-2 text-caption text-error">Marked outdated in global catalog.</p>
            )}
            {!d.enabled && (
              <p className="mt-2 text-caption text-error">Disabled in global catalog.</p>
            )}
            {d.incompleteCoverage && (
              <p className="mt-2 text-caption text-secondary">Incomplete geographic coverage.</p>
            )}
            <ul className="mt-3 text-caption text-on-surface-variant list-disc pl-4">
              {d.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-2 text-caption">
              Features: {d.featureCount}
            </p>
          </div>
        );})}
      </div>
      <div className="mt-8">
        <h3 className="text-headline-md mb-3">Active assumptions</h3>
        <div className="space-y-2">
          {scenario.assumptions.map((a) => (
            <div key={a.id} className="border border-outline-variant p-3">
              <div className="font-mono text-data-label">
                {a.label}: {String(a.value)} {a.unit ?? ""}
              </div>
              <p className="text-caption text-on-surface-variant">{a.description}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function formatCompareCell(value: string | number | undefined): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

const COMPARE_METRICS: Array<{ key: string; label: string }> = [
  { key: "eligible_count", label: "Eligible areas" },
  { key: "meets_target_count", label: "Meet housing target alone" },
  { key: "total_capacity", label: "Est. housing capacity" },
  { key: "avg_transit_distance", label: "Avg transit distance (m)" },
  { key: "median_transit_distance", label: "Median transit distance (m)" },
  { key: "top_candidate", label: "Top candidate" },
  { key: "top_candidate_capacity", label: "Top candidate capacity" },
  { key: "top_rank_score", label: "Top rank score (scenario-local)" },
  { key: "top_3", label: "Top 3 candidates" },
  { key: "weight_profile", label: "Priority weights" },
];

function CompareView(props: {
  workspace: WorkspaceSnapshot;
  compareIds: string[];
  setCompareIds: Dispatch<SetStateAction<string[]>>;
  comparison: Array<Record<string, string | number>> | null;
  insights: Array<{ heading: string; body: string }> | null;
  busy?: boolean;
  error?: string | null;
  hint?: string | null;
  onHint: (msg: string | null) => void;
  onCompare: () => Promise<void>;
  onPrefer: (id: string) => Promise<void>;
}) {
  const { workspace } = props;

  function toggleScenario(id: string) {
    props.setCompareIds((prev) => {
      const on = prev.includes(id);
      if (on) {
        if (prev.length <= 2) {
          props.onHint("Keep at least two scenarios selected to compare.");
          return prev;
        }
        props.onHint(null);
        return prev.filter((x) => x !== id);
      }
      props.onHint(null);
      return [...prev, id];
    });
  }

  return (
    <main className="flex-1 overflow-auto p-8">
      <h2 className="text-display mb-2">Scenario comparison</h2>
      <p className="text-body-sm text-on-surface-variant mb-2">
        Select two or more scenarios with completed analysis, then compare trade-offs.
      </p>
      <p className="text-caption text-on-surface-variant mb-6">
        Rank scores are comparable within a scenario only — use ranking shifts and capacity metrics
        to evaluate differences.
      </p>
      <div className="flex flex-wrap gap-3 mb-2" role="group" aria-label="Scenarios to compare">
        {workspace.scenarios.map((s) => {
          const on = props.compareIds.includes(s.id);
          const hasResult = Boolean(s.latestResultId);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              aria-label={`${on ? "Deselect" : "Select"} scenario ${s.name}`}
              onClick={() => toggleScenario(s.id)}
              className={`px-3 py-1.5 border text-body-sm transition-colors ${
                on ? "border-primary bg-primary-fixed/30 text-primary" : "border-outline-variant"
              } ${!hasResult ? "opacity-60" : ""}`}
            >
              {s.name}
              {!hasResult && (
                <span className="ml-1 text-caption text-on-surface-variant">(no results)</span>
              )}
              {on && <span className="ml-2 font-mono text-[10px]">selected</span>}
            </button>
          );
        })}
      </div>
      {props.hint && (
        <p className="text-caption text-secondary mb-3" role="status">
          {props.hint}
        </p>
      )}
      {props.compareIds.length < 2 && (
        <p className="text-caption text-on-surface-variant mb-3">
          Select at least two scenarios to enable comparison.
        </p>
      )}
      <button
        type="button"
        disabled={props.compareIds.length < 2 || props.busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void props.onCompare();
        }}
        className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-40 mb-2"
      >
        {props.busy ? "Comparing…" : `Compare selected (${props.compareIds.length})`}
      </button>
      {props.error && (
        <p className="text-body-sm text-error mb-4" role="alert">
          {props.error}
        </p>
      )}
      {props.busy && !props.comparison && (
        <p className="text-body-sm text-on-surface-variant mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-primary text-[18px]">
            progress_activity
          </span>
          Building comparison…
        </p>
      )}
      {props.comparison && props.comparison.length > 0 && (
        <div className="overflow-auto border border-outline-variant bg-surface-container-lowest mb-6">
          <table className="w-full text-body-sm">
            <thead className="bg-surface-container-low font-mono text-data-label">
              <tr>
                <th className="p-3 text-left">Metric</th>
                {props.comparison.map((row) => (
                  <th key={String(row.scenarioId)} className="p-3 text-left">
                    {row.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_METRICS.map(({ key, label }) => (
                  <tr key={key} className="border-t border-outline-variant">
                    <td className="p-3 font-mono text-caption">{label}</td>
                    {props.comparison!.map((row) => (
                      <td key={String(row.scenarioId)} className="p-3 font-mono">
                        {formatCompareCell(row[key] as string | number | undefined)}
                      </td>
                    ))}
                  </tr>
                )
              )}
            </tbody>
          </table>
          <div className="p-4 flex flex-wrap gap-2 border-t border-outline-variant">
            {props.comparison.map((row) => (
              <button
                key={String(row.scenarioId)}
                onClick={() => props.onPrefer(String(row.scenarioId))}
                className="bg-secondary text-on-secondary px-3 py-1.5 text-body-sm rounded"
              >
                Select {row.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {props.insights && props.insights.length > 0 && (
        <div className="space-y-3 border border-outline-variant bg-surface-container-low p-4">
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant">
            Trade-off insights
          </h3>
          {props.insights.map((item) => (
            <div key={item.heading}>
              <h4 className="text-body-sm font-medium">{item.heading}</h4>
              <p className="text-body-sm text-on-surface-variant">{item.body}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function DecisionView(props: {
  workspace: WorkspaceSnapshot;
  scenario: WorkspaceSnapshot["scenarios"][0];
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  topCandidate: Candidate | null;
  layerData: Record<string, GeoJSON.FeatureCollection>;
  reason: string;
  setReason: (v: string) => void;
  error: string | null;
  confirmType: "approve_scenario" | "reject_scenario" | "request_changes" | null;
  onRequestConfirm: (
    type: "approve_scenario" | "reject_scenario" | "request_changes"
  ) => void;
  onCancelConfirm: () => void;
  onDecide: (type: "approve_scenario" | "reject_scenario" | "request_changes") => Promise<void>;
}) {
  const { scenario, result, topCandidate } = props;
  const analysisReady = Boolean(result && result.status === "completed" && result.candidates.length > 0);
  const hasFreshAnalysis = analysisReady && !result?.stale;
  const decisionLabel =
    scenario.decisionStatus === "approved" && scenario.decisionStale
      ? "Approved (stale)"
      : formatDecisionStatus(scenario.decisionStatus);
  const mapCandidates = result?.candidates ?? [];

  return (
    <main className="flex-1 flex overflow-hidden min-h-0">
      <div className="flex-1 overflow-auto p-8 max-w-3xl min-h-0">
      <h2 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
        Review decision
      </h2>
      <h3 className="text-display mb-6">{scenario.name}</h3>
      {!result && (
        <p className="text-body-sm text-secondary mb-4" role="status">
          No analysis results for this scenario yet — run analysis from the Workspace tab first.
        </p>
      )}
      {result?.stale && (
        <p className="text-body-sm text-secondary mb-4" role="status">
          Results are stale ({result.staleReason ?? "inputs changed"}) — recalculate before deciding.
        </p>
      )}
      {hasFreshAnalysis && (
        <p className="text-body-sm text-on-surface-variant mb-4" role="status">
          Analysis complete with {result!.candidates.length} candidates — ready for your decision.
        </p>
      )}
      {result && scenario.objective.intent === "housing_capacity" && (
        <p className="text-body-sm font-medium text-primary mb-4 border border-primary-fixed/40 bg-primary-fixed/10 px-3 py-2 rounded">
          {housingGoalSummary({
            target: scenario.objective.targetValue,
            totalCapacity: result.aggregateMetrics.find((m) => m.key === "total_capacity")?.value,
            targetGapMetric: result.aggregateMetrics.find((m) => m.key === "housing_target_gap"),
          }) ?? "Housing target metrics unavailable — recalculate analysis."}
        </p>
      )}
      <div className="mb-4">
        <ProvenanceChip kind="copilot_recommendation" />
        <p className="text-body-sm mt-2">
          {topCandidate
            ? `Copilot recommends ${topCandidate.label} (score ${topCandidate.score.toFixed(1)}).`
            : "No recommendation available yet."}
        </p>
      </div>
      <section className="mb-6 border border-outline-variant p-4 space-y-3">
        <h4 className="font-mono text-data-label uppercase">Evidence summary</h4>
        <p className="text-body-sm">
          <strong>Objective:</strong> {scenario.objective.rawText}
        </p>
        <p className="text-body-sm">
          <strong>Assumptions:</strong>{" "}
          {scenario.assumptions.map((a) => `${a.label}: ${a.value}${a.unit ? ` ${a.unit}` : ""}`).join("; ")}
        </p>
        <p className="text-body-sm">
          <strong>Constraints:</strong>{" "}
          {scenario.constraints
            .filter((c) => c.enabled)
            .map((c) => c.label)
            .join("; ")}
        </p>
        <p className="text-body-sm">
          <strong>Results:</strong> {result?.summary ?? "No analysis yet"}
        </p>
        <p className="text-body-sm text-secondary">
          <strong>Limitations:</strong>{" "}
          {dedupeLimitations(result?.limitations ?? []).join("; ") || "None recorded"}
        </p>
      </section>
      <label className="block mb-4">
        <span className="font-mono text-data-label uppercase text-on-surface-variant">
          Reason for decision
        </span>
        <textarea
          value={props.reason}
          onChange={(e) => props.setReason(e.target.value)}
          className={`mt-2 w-full border rounded p-3 text-body-sm ${
            props.error ? "border-error" : "border-outline-variant"
          }`}
          rows={3}
          placeholder="Required for approve/reject — substantive justification for the audit trail"
          disabled={!hasFreshAnalysis}
        />
        {props.error && (
          <p className="text-caption text-error mt-1" role="alert">
            {props.error}
          </p>
        )}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!hasFreshAnalysis}
          onClick={() => props.onRequestConfirm("approve_scenario")}
          className="bg-secondary text-on-secondary px-4 py-2 rounded text-body-sm disabled:opacity-40"
        >
          Approve scenario
        </button>
        <button
          type="button"
          disabled={!hasFreshAnalysis}
          onClick={() => props.onRequestConfirm("request_changes")}
          className="border border-outline px-4 py-2 rounded text-body-sm disabled:opacity-40"
        >
          Request changes
        </button>
        <button
          type="button"
          disabled={!hasFreshAnalysis}
          onClick={() => props.onRequestConfirm("reject_scenario")}
          className="border border-error text-error px-4 py-2 rounded text-body-sm disabled:opacity-40"
        >
          Reject
        </button>
      </div>
      <p className="mt-4 text-caption text-on-surface-variant">
        Current decision status:{" "}
        <span className="font-medium text-secondary">{decisionLabel}</span>
        {scenario.decisionStaleReason && (
          <span className="block mt-1 text-error">{scenario.decisionStaleReason}</span>
        )}
      </p>
      <div className="mt-8 max-h-[40vh] overflow-y-auto">
        <h4 className="font-mono text-data-label uppercase mb-3">Decision history</h4>
        <ul className="space-y-2">
          {props.workspace.decisions
            .filter((d) => d.scenarioId === scenario.id)
            .map((d) => (
              <li key={d.id} className="text-body-sm border-b border-outline-variant pb-2">
                <span className="font-mono text-caption text-on-surface-variant">
                  {formatLocaleDateTime(d.createdAt)}
                </span>
                <div>
                  <ProvenanceChip kind="planner_decision" /> {formatDecisionType(d.type)}
                  {d.reason ? ` — ${d.reason}` : ""}
                </div>
              </li>
            ))}
        </ul>
      </div>

      {props.confirmType && (
        <div
          className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-decision-title"
        >
          <div className="bg-surface max-w-lg w-full rounded-lg border border-outline-variant p-6 shadow-xl">
            <h4 id="confirm-decision-title" className="text-headline-md mb-3">
              Confirm {formatDecisionType(props.confirmType)}
            </h4>
            <p className="text-body-sm text-on-surface-variant mb-4">
              You are about to record a planner decision on <strong>{scenario.name}</strong>.
              Review the evidence summary above, then confirm.
            </p>
            <div className="text-body-sm space-y-2 mb-4 border border-outline-variant p-3 rounded bg-surface-container-low">
              <p>
                <strong>Copilot recommendation:</strong>{" "}
                {topCandidate ? `${topCandidate.label} (score ${topCandidate.score.toFixed(1)})` : "—"}
              </p>
              <p>
                <strong>Your reason:</strong> {props.reason.trim() || "(none entered)"}
              </p>
              <p>
                <strong>Limitations:</strong> {result?.limitations.slice(0, 2).join("; ") || "None"}
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={props.onCancelConfirm}
                className="border border-outline-variant px-4 py-2 rounded text-body-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void props.onDecide(props.confirmType!)}
                className="bg-secondary text-on-secondary px-4 py-2 rounded text-body-sm"
              >
                Confirm decision
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      <aside className="hidden lg:flex flex-1 min-w-[300px] max-w-[50%] flex-col border-l border-outline-variant bg-surface-container-low min-h-0">
        <div className="p-4 border-b border-outline-variant shrink-0">
          <h4 className="font-mono text-data-label uppercase text-on-surface-variant">
            Scenario map
          </h4>
          <p className="text-caption text-on-surface-variant mt-1">
            {mapCandidates.length > 0
              ? `${mapCandidates.length} candidates from ${result?.stale ? "last" : "current"} analysis`
              : "Run analysis to see candidate sites on the map"}
          </p>
        </div>
        <div className="flex-1 relative min-h-[280px]">
          <PlanningMap
            workspace={props.workspace}
            layerData={props.layerData}
            candidates={mapCandidates}
            onSelectCandidate={() => undefined}
            stale={Boolean(result?.stale)}
          />
        </div>
      </aside>
    </main>
  );
}

function ActivityView(props: {
  workspace: WorkspaceSnapshot;
  selected: WorkspaceSnapshot["activities"][0] | undefined;
  onSelect: (id: string) => void;
}) {
  const [actorFilter, setActorFilter] = useState<"all" | "human" | "agent" | "system">("all");
  const [scenarioFilter, setScenarioFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = props.workspace.activities.filter((a) => {
    if (actorFilter !== "all" && a.actor !== actorFilter) return false;
    if (scenarioFilter !== "all" && a.scenarioId !== scenarioFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const scenarioName =
        props.workspace.scenarios.find((s) => s.id === a.scenarioId)?.name ?? "";
      const blob = `${a.summary} ${a.action} ${scenarioName}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  const scenarioName = props.selected?.scenarioId
    ? props.workspace.scenarios.find((s) => s.id === props.selected?.scenarioId)?.name
    : undefined;

  return (
    <main className="flex-1 min-h-0 overflow-hidden grid md:grid-cols-[1fr_360px]">
      <div className="overflow-y-auto p-6 min-h-0">
        <h2 className="text-display mb-4">Activity &amp; provenance</h2>
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="text-caption">
            Actor{" "}
            <select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value as typeof actorFilter)}
              className="ml-1 border border-outline-variant rounded px-2 py-1 text-body-sm"
            >
              <option value="all">All</option>
              <option value="human">You</option>
              <option value="agent">Copilot</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="text-caption">
            Scenario{" "}
            <select
              value={scenarioFilter}
              onChange={(e) => setScenarioFilter(e.target.value)}
              className="ml-1 border border-outline-variant rounded px-2 py-1 text-body-sm"
            >
              <option value="all">All</option>
              {props.workspace.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <input
            type="search"
            placeholder="Search activity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-outline-variant rounded px-3 py-1 text-body-sm min-w-[180px]"
          />
        </div>
        <ul className="space-y-3">
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => props.onSelect(a.id)}
                className="w-full text-left border border-outline-variant p-3 hover:border-primary"
              >
                <div className="flex justify-between gap-2 mb-1">
                  <span
                    className={`font-mono text-[10px] uppercase ${
                      a.actor === "human" ? "text-secondary" : "text-primary"
                    }`}
                  >
                    {formatActivitySummary(a)}
                  </span>
                  <span className="font-mono text-[10px] text-on-surface-variant whitespace-nowrap">
                    {formatLocaleDateTime(a.timestamp)}
                  </span>
                </div>
                <div className="text-body-sm text-on-surface-variant">{a.summary}</div>
                {a.scenarioId && (
                  <div className="text-caption text-on-surface-variant mt-1">
                    Scenario:{" "}
                    {props.workspace.scenarios.find((s) => s.id === a.scenarioId)?.name ?? a.scenarioId}
                  </div>
                )}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="text-body-sm text-on-surface-variant">No events match these filters.</li>
          )}
        </ul>
      </div>
      <aside className="border-l border-outline-variant p-6 overflow-y-auto bg-surface-container-low min-h-0">
        <h3 className="text-headline-md mb-4">Event details</h3>
        {!props.selected ? (
          <p className="text-body-sm text-on-surface-variant">Select an event.</p>
        ) : (
          <div className="space-y-4 text-body-sm">
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">When</div>
              <p>{formatLocaleDateTime(props.selected.timestamp)}</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">Actor</div>
              <p>{formatActivitySummary(props.selected)}</p>
            </div>
            {scenarioName && (
              <div>
                <div className="font-mono text-[10px] uppercase text-outline mb-1">Scenario</div>
                <p>{scenarioName}</p>
              </div>
            )}
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">What happened</div>
              <p>{props.selected.summary}</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">Action</div>
              <p className="font-mono">{props.selected.action}</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">Inputs</div>
              <pre className="text-caption whitespace-pre-wrap bg-surface p-2 border border-outline-variant">
                {props.selected.inputs
                  ? JSON.stringify(props.selected.inputs, null, 2)
                  : "—"}
              </pre>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">Outputs</div>
              <pre className="text-caption whitespace-pre-wrap bg-surface p-2 border border-outline-variant">
                {props.selected.outputs &&
                Object.keys(props.selected.outputs).length > 0
                  ? JSON.stringify(props.selected.outputs, null, 2)
                  : "—"}
              </pre>
            </div>
            {props.selected.relatedDatasetIds?.length ? (
              <div>
                <div className="font-mono text-[10px] uppercase text-outline mb-1">Datasets</div>
                <ul className="text-caption space-y-1">
                  {props.selected.relatedDatasetIds.map((id) => {
                    const ds = props.workspace.datasets.find((d) => d.id === id);
                    return (
                      <li key={id}>
                        {ds?.name ?? id} · v{ds?.version ?? "?"} ·{" "}
                        {ds?.dataVintage ?? "vintage unknown"}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </aside>
    </main>
  );
}

function ReportView(props: {
  workspace: WorkspaceSnapshot;
  scenario: WorkspaceSnapshot["scenarios"][0];
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  selectedReportId: string | null;
  onSelectReport: (id: string) => void;
  onGenerate: () => Promise<void>;
  onDownload?: (message: string) => void;
  generating?: boolean;
}) {
  const [localGenerating, setLocalGenerating] = useState(false);
  const generating = props.generating || localGenerating;
  const scenarioReports = props.workspace.reports.filter((r) =>
    r.scenarioIds.includes(props.scenario.id)
  );
  const otherReports = props.workspace.reports.filter(
    (r) => !r.scenarioIds.includes(props.scenario.id)
  );
  const displayReport =
    props.workspace.reports.find((r) => r.id === props.selectedReportId) ?? scenarioReports[0];
  const canGenerate = Boolean(props.result && !props.result.stale);
  const housingGoal =
    props.result && props.scenario.objective.intent === "housing_capacity"
      ? housingGoalSummary({
          target: props.scenario.objective.targetValue,
          totalCapacity: props.result.aggregateMetrics.find((m) => m.key === "total_capacity")?.value,
          targetGapMetric: props.result.aggregateMetrics.find((m) => m.key === "housing_target_gap"),
        })
      : null;

  function downloadMarkdown() {
    if (!displayReport) {
      props.onDownload?.("No report selected — generate a report first.");
      return;
    }
    try {
      const lines = [
        `# ${displayReport.title}`,
        ``,
        `Generated: ${formatReportDateTime(displayReport.createdAt)}`,
        `Audience: ${displayReport.audience}`,
        ``,
      ];
      for (const s of displayReport.sections) {
        lines.push(`## ${s.heading}`, ``, s.body, ``);
        if (s.data && Array.isArray(s.data) && s.data.length > 0 && "name" in (s.data[0] as object)) {
          lines.push(
            `| Scenario | Eligible | Capacity | Avg transit (m) | Top score |`,
            `| --- | ---: | ---: | ---: | ---: |`
          );
          for (const row of s.data as Array<Record<string, string | number>>) {
            lines.push(
              `| ${row.name} | ${row.eligible_count ?? "—"} | ${row.total_capacity ?? "—"} | ${row.avg_transit_distance ?? "—"} | ${row.top_rank_score ?? row.top_score ?? "—"} |`
            );
          }
          lines.push(``);
        }
      }
      const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = `${displayReport.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "planning-report"}.md`;
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
      props.onDownload?.(`Downloaded ${filename}`);
    } catch (e) {
      props.onDownload?.(
        e instanceof Error ? e.message : "Could not download report — try again."
      );
    }
  }

  return (
    <main className="flex-1 overflow-auto p-8 max-w-4xl">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h2 className="text-display">Reports</h2>
        <div className="flex gap-2">
          {displayReport && (
            <button
              type="button"
              onClick={downloadMarkdown}
              className="border border-outline-variant px-4 py-2 rounded text-body-sm"
            >
              Download Markdown
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              setLocalGenerating(true);
              try {
                await props.onGenerate();
              } finally {
                setLocalGenerating(false);
              }
            }}
            disabled={!canGenerate || generating}
            title={
              canGenerate
                ? undefined
                : "Run analysis on the active scenario first"
            }
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-40 flex items-center gap-2"
          >
            {generating && (
              <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
            )}
            {generating ? "Generating…" : "Generate report"}
          </button>
        </div>
      </div>
      {!canGenerate && (
        <p className="text-body-sm text-on-surface-variant mb-4">
          Reports summarize the active scenario <strong>{props.scenario.name}</strong>, its
          evidence, constraints, and any recorded decision. Run analysis first — stale results must
          be recalculated.
        </p>
      )}
      {canGenerate && !displayReport && (
        <p className="text-body-sm text-on-surface-variant mb-4">
          Generate a markdown report for <strong>{props.scenario.name}</strong> including objective,
          methodology, datasets, results ({props.result?.candidates.length ?? 0} candidates), and
          decision history.
        </p>
      )}
      {housingGoal && (
          <p className="text-body-sm font-medium text-primary mb-4 border border-primary-fixed/40 bg-primary-fixed/10 px-3 py-2 rounded">
            {housingGoal}
          </p>
        )}
      {scenarioReports.length > 1 && (
        <div className="mb-6">
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
            Report history
          </h3>
          <ul className="space-y-1">
            {scenarioReports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => props.onSelectReport(r.id)}
                  className={`text-body-sm text-left w-full px-3 py-2 rounded border ${
                    r.id === displayReport?.id
                      ? "border-primary bg-primary-fixed/20"
                      : "border-outline-variant hover:bg-surface-container-low"
                  }`}
                >
                  {r.title}
                  <span className="block text-caption text-on-surface-variant">
                    {formatReportDateTime(r.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!displayReport ? (
        <p className="text-body-sm text-on-surface-variant">No reports yet for this scenario.</p>
      ) : (
        <article className="border border-outline-variant bg-surface-container-lowest p-8 space-y-6">
          <header>
            <h1 className="text-headline-md mb-1">{displayReport.title}</h1>
            <p className="text-caption text-on-surface-variant">
              Generated {formatReportDateTime(displayReport.createdAt)} · Audience: {displayReport.audience}
            </p>
          </header>
          {displayReport.sections.map((s, i) => (
            <section key={i}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-body-sm font-medium">{s.heading}</h3>
                {s.kind === "source_data" ||
                s.kind === "calculated" ||
                s.kind === "copilot_recommendation" ||
                s.kind === "planner_decision" ? (
                  <ProvenanceChip kind={s.kind} />
                ) : null}
              </div>
              <p className="text-body-sm whitespace-pre-wrap text-on-surface-variant">{s.body}</p>
              {s.data != null && Array.isArray(s.data) && s.kind === "comparison" && (
                <div className="mt-3 overflow-auto border border-outline-variant">
                  <table className="w-full text-body-sm">
                    <thead className="bg-surface-container-low font-mono text-data-label">
                      <tr>
                        <th className="p-2 text-left">Metric</th>
                        {(s.data as Array<Record<string, string | number>>).map((row) => (
                          <th key={String(row.scenarioId)} className="p-2 text-left">
                            {row.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARE_METRICS.map(({ key, label }) => (
                        <tr key={key} className="border-t border-outline-variant">
                          <td className="p-2 font-mono text-caption">{label}</td>
                          {(s.data as Array<Record<string, string | number>>).map((row) => (
                            <td key={String(row.scenarioId)} className="p-2 font-mono">
                              {formatCompareCell(row[key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {s.data != null &&
                Array.isArray(s.data) &&
                s.kind === "calculated" &&
                (s.data as Array<{ key?: string; label?: string; value?: number; unit?: string }>)[0]
                  ?.key != null && (
                <div className="mt-3 overflow-auto border border-outline-variant">
                  <table className="w-full text-body-sm">
                    <thead className="bg-surface-container-low font-mono text-data-label">
                      <tr>
                        <th className="p-2 text-left">Metric</th>
                        <th className="p-2 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        s.data as Array<{
                          key: string;
                          label: string;
                          value: number;
                          unit?: string;
                        }>
                      ).map((m) => (
                        <tr key={m.key} className="border-t border-outline-variant">
                          <td className="p-2">{m.label}</td>
                          <td className="p-2 text-right font-mono">
                            {m.value.toLocaleString()}
                            {m.unit ? ` ${m.unit}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </article>
      )}
      {otherReports.length > 0 && (
        <section className="mt-10 border-t border-outline-variant pt-6">
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
            Reports for other scenarios ({otherReports.length})
          </h3>
          <p className="text-caption text-on-surface-variant mb-3">
            These reports were generated for different scenarios — switch the active scenario or
            open them below.
          </p>
          <ul className="space-y-1">
            {otherReports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => props.onSelectReport(r.id)}
                  className="text-body-sm text-left w-full px-3 py-2 rounded border border-outline-variant hover:bg-surface-container-low"
                >
                  {r.title}
                  <span className="block text-caption text-on-surface-variant">
                    {formatReportDateTime(r.createdAt)} · scenarios:{" "}
                    {r.scenarioIds
                      .map(
                        (id) =>
                          props.workspace.scenarios.find((s) => s.id === id)?.name ?? id
                      )
                      .join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
