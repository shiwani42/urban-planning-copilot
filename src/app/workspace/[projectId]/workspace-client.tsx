"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, Component, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  ProvenanceChip,
  useWorkspace,
} from "@/components/workspace-hooks";
import {
  PROJECT_NOT_FOUND_HELP,
  PROJECT_NOT_ON_SERVER_DETAIL,
  PROJECT_UNAVAILABLE_DETAIL,
  RANKING_STALE_FALLBACK,
  SHORTLIST_SAVE_FAILED,
} from "@/lib/planner-copy";
import { StorageBanner } from "@/components/StorageBanner";
import { ServerWakeBanner } from "@/components/ServerWakeBanner";
import { DatasetProvenanceChips } from "@/components/DatasetProvenanceChips";
import { DatasetInspectPanel } from "@/components/DatasetInspectPanel";
import {
  CopilotActivityFeed,
  UrbanPlanningCopilot,
} from "@/components/UrbanPlanningCopilot";
import { listCopilotActivity } from "@/lib/copilot/copilot-activity";
import { outcomeFromWorkspace } from "@/lib/copilot/workspace-outcome";
import {
  onWorkspaceMutated,
  type CompareScenariosToolPayload,
} from "@/lib/workspace-sync";
import { setWebMcpBrowserContext, clearWebMcpBrowserContext } from "@/lib/webmcp/browser-context";
import {
  listPendingPlannerActions,
  onPlannerPending,
  type PendingPlannerAction,
} from "@/lib/planner-pending";
import { resolvePendingPlannerAction } from "@/lib/webmcp/register-browser";
import {
  formatActivitySummary,
  formatDecisionStatus,
  formatDecisionType,
  formatLocaleDateTime,
  formatLocaleTime,
  formatReportDateTime,
} from "@/lib/format";
import {
  ACTIVITY_FILTER_LABELS,
  activityActorAccent,
  activityCategoryLabel,
  matchesActivityFilter,
  type ActivityFilter,
} from "@/lib/activity-filters";
import { trackRecentProject } from "@/lib/project-recency";
import {
  normalizeTransitThresholdMeters,
} from "@/lib/domain/transit-threshold";
import type {
  AnalysisResult,
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
import {
  aggregateMetricValue,
  analysisAggregateMetrics,
  analysisLimitations,
  candidateMetricValue,
  candidateProvenance,
  formatCandidateScore,
  limitationsSummary,
} from "@/lib/domain/analysis-display";
import { filterAnalysisCaveats } from "@/lib/domain/caveats";
import { objectiveTitleMismatchWarning } from "@/lib/objective-display";
import { layerSwatch } from "@/lib/domain/layer-styles";
import {
  applyFloodWeightedWeights,
  isFloodWeightedBranchName,
  rebalanceWeights,
  weightsEqual,
} from "@/lib/domain/weights";
import {
  buildCompareTableRows,
  RANK_SCORE_EXPLANATION,
  type CompareTableRow,
  type HousingTargetProgress,
  type ScenarioInputsDiff,
} from "@/lib/domain/compare";
import {
  isCandidateShortlisted,
  resolveShortlist,
  shortlistPinReason,
  type ResolvedShortlistEntry,
} from "@/lib/domain/shortlist";
import { applyShortlistMutation } from "@/lib/domain/shortlist-optimistic";
import {
  buildFloodCoverageDetail,
  candidateFloodIncompleteCaveat,
  type FloodCoverageDetail,
} from "@/lib/domain/flood-coverage";
import {
  candidateNeighborhoods,
  DEFAULT_RESULTS_FILTER,
  filterCandidates,
  type ResultsFilterState,
} from "@/lib/domain/results-filter";
import { computeYieldGap, type YieldGapSummary } from "@/lib/domain/yield-gap";
import {
  resolveHousingTarget,
  rankingStaleMessage,
  rankingStaleVersusObjective,
  analyzedHousingTarget,
  topSiteCapacityFromResult,
  totalCapacityFromResult,
} from "@/lib/domain/housing-target";
import {
  firstUnanalyzedScenarioName,
  defaultCompareScenarioIds,
  scenarioHasComparableAnalysis,
} from "@/lib/domain/scenario-resolution";
import { validateDecisionReason, requireAnalysisForDecision } from "@/lib/domain/decision";
import { reportStaleLabel } from "@/lib/report-freshness";
import type { MapDrawMode } from "@/components/PlanningMap";
import { CompareScenarioMaps } from "@/components/CompareScenarioMaps";
import {
  parseCompareScenarioIds,
  parseWorkspacePathTab,
  resolveWorkspaceTabFromParams,
  WORKSPACE_TAB_KEYBOARD_SHORTCUTS,
  workspaceTabUrl,
  type WorkspaceTab,
} from "@/lib/workspace-tabs";
import { EMPTY_ANALYSIS_STATUS } from "@/lib/workspace-analysis-status";

const PlanningMap = dynamic(
  () => import("@/components/PlanningMap").then((m) => m.default),
  { ssr: false }
);
const MapLegend = dynamic(
  () => import("@/components/PlanningMap").then((m) => m.MapLegend),
  { ssr: false }
);

type Tab = WorkspaceTab;

type DrawerPanel = "candidates" | "evidence";

type ToastState = {
  message: string;
  undo?: () => void;
  action?: { label: string; onClick: () => void };
} | null;

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

function constraintChipIcon(label: string, datasetKind?: string): string {
  const lower = label.toLowerCase();
  if (datasetKind === "transit" || lower.includes("transit")) return "train";
  if (datasetKind === "flood" || lower.includes("flood")) return "water_drop";
  if (lower.includes("zoning") || lower.includes("residential")) return "home";
  return "rule";
}

class TabErrorBoundary extends Component<
  { tabName: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { tabName: string }) {
    if (prevProps.tabName !== this.props.tabName && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex-1 overflow-auto p-8 max-w-3xl">
          <h2 className="text-headline-md text-error mb-2">{this.props.tabName} view error</h2>
          <p className="text-body-sm text-on-surface-variant mb-4">
            Something went wrong rendering this tab. Your project and analysis data are still
            loaded — switch tabs or retry below.
          </p>
          <p className="text-caption font-mono text-on-surface-variant mb-4 border border-outline-variant p-3 rounded bg-surface-container-low">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm"
          >
            Try again
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function WorkspaceClient({
  projectId,
}: {
  projectId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { workspace, loading, error, busy, act, refresh, clearError, loadPhase, elapsedMs, isRetrying, refreshing, projectNotFound, lastFetchAt, setWorkspace } =
    useWorkspace(projectId);
  const [tab, setTabState] = useState<Tab>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return resolveWorkspaceTabFromParams({
        tab: params.get("tab"),
        initialTab: params.get("initialTab"),
        pathTab: parseWorkspacePathTab(window.location.pathname),
      }) as Tab;
    }
    return "workspace";
  });
  const [layerData, setLayerData] = useState<Record<string, GeoJSON.FeatureCollection>>({});
  const layerDataRef = useRef<Record<string, GeoJSON.FeatureCollection>>({});
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
  const [compareInputsDiff, setCompareInputsDiff] = useState<ScenarioInputsDiff | null>(null);
  const [compareTableRows, setCompareTableRows] = useState<CompareTableRow[] | null>(null);
  const [compareHousingTargets, setCompareHousingTargets] = useState<
    Array<{ scenarioId: string; name: string; progress: HousingTargetProgress | null }> | null
  >(null);
  const [compareMetricsIdentical, setCompareMetricsIdentical] = useState(false);
  const [compareSortKey, setCompareSortKey] = useState<"label" | "delta">("label");
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareHint, setCompareHint] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [inspectDatasetId, setInspectDatasetId] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [renamingScenarioId, setRenamingScenarioId] = useState<string | null>(null);
  const [scenarioNameDraft, setScenarioNameDraft] = useState("");
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [selectionUpdated, setSelectionUpdated] = useState(false);
  const prevResultIdRef = useRef<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [transitDraftText, setTransitDraftText] = useState<Record<string, string>>({});
  const [transitThresholdWarning, setTransitThresholdWarning] = useState<string | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [geoSaving, setGeoSaving] = useState(false);
  const [exportingMap, setExportingMap] = useState(false);
  const [recoveringScenario, setRecoveringScenario] = useState(false);
  const [criteriaStaleHint, setCriteriaStaleHint] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [pendingPlannerActions, setPendingPlannerActions] = useState<PendingPlannerAction[]>([]);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateNameDraft, setDuplicateNameDraft] = useState("");
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [highlightWeightsPanel, setHighlightWeightsPanel] = useState(false);
  const [resultsFilter, setResultsFilter] = useState<ResultsFilterState>(DEFAULT_RESULTS_FILTER);
  const weightsPanelRef = useRef<HTMLElement | null>(null);
  const compareTabEnteredRef = useRef(false);

  const applyCompareFromPayload = useCallback(
    (ids: string[], data: CompareScenariosToolPayload) => {
      if (data.status === "incomplete") {
        setComparison(null);
        setCompareInsights(null);
        setCompareInputsDiff(null);
        setCompareTableRows(null);
        setCompareHousingTargets(null);
        setCompareMetricsIdentical(false);
        const recovery =
          typeof data.message === "string"
            ? data.message.replace(/^Run analysis first for:\s*/i, "")
            : "";
        setCompareHint(
          recovery
            ? recovery
                .split(",")
                .map((name) => name.trim())
                .filter(Boolean)
                .map((name) => `Run analysis on ${name}`)
                .join(" · ")
            : "Run analysis on each selected branch before comparing."
        );
      } else {
        setComparison(data.comparison ?? null);
        setCompareTableRows(data.tableRows ?? null);
        setCompareInputsDiff(data.inputsDiff ?? null);
        setCompareHousingTargets(data.housingTargets ?? null);
        setCompareMetricsIdentical(Boolean(data.metricsIdentical));
        setCompareInsights(data.insights ?? null);
        setCompareHint(null);
      }
      setCompareIds(ids);
      setCompareError(null);
    },
    []
  );

  const setTab = useCallback(
    (next: Tab, options?: { compareScenarioIds?: string[] }) => {
      setTabState(next);
      if (next !== "workspace") setDrawerOpen(false);
      const compareScenarioIds =
        options?.compareScenarioIds ??
        (next === "compare" && compareIds.length >= 2 ? compareIds : undefined);
      const href = workspaceTabUrl(projectId, next, {
        scenarioId: searchParams.get("scenarioId"),
        compareScenarioIds,
      });
      router.replace(href, { scroll: false });
    },
    [projectId, router, searchParams, compareIds]
  );

  useEffect(() => {
    const pathTab = parseWorkspacePathTab(pathname);
    const tabParam = searchParams.get("tab");
    const initialTabParam = searchParams.get("initialTab");
    const fromQuery = tabParam ?? initialTabParam;
    const resolved = resolveWorkspaceTabFromParams({
      tab: fromQuery,
      initialTab: initialTabParam,
      pathTab,
    }) as Tab;
    if (TAB_PATHS.includes(resolved)) {
      setTabState(resolved);
    }

    const legacyTab = fromQuery ? resolveWorkspaceTabFromParams({ tab: fromQuery }) : null;
    const onBaseWorkspacePath = pathname === `/workspace/${projectId}`;
    if (legacyTab && legacyTab !== "workspace" && onBaseWorkspacePath) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tab");
      params.delete("initialTab");
      const canonical = workspaceTabUrl(projectId, legacyTab, {
        scenarioId: params.get("scenarioId"),
        compareScenarioIds: parseCompareScenarioIds(params.get("compareScenarioIds")),
      });
      if (canonical !== `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`) {
        router.replace(canonical, { scroll: false });
      }
    }
  }, [pathname, searchParams, projectId, router]);

  useEffect(() => {
    if (tab !== "activity" || !workspace?.activities.length) return;
    if (activityId && workspace.activities.some((a) => a.id === activityId)) return;
    setActivityId(workspace.activities[0]!.id);
  }, [tab, workspace?.activities, activityId]);

  const scenario = useMemo(() => {
    if (!workspace) return undefined;
    const scenarios = workspace.scenarios;
    const activeId = workspace.project.activeScenarioId;
    if (activeId) {
      const active = scenarios.find((s) => s.id === activeId);
      if (active) return active;
    }
    return (
      scenarios.find((s) => s.name.trim().toLowerCase() === "baseline") ?? scenarios[0]
    );
  }, [workspace]);

  const scenarioIdForActions = useCallback(() => {
    return workspace?.project.activeScenarioId ?? scenario?.id;
  }, [workspace?.project.activeScenarioId, scenario?.id]);

  useEffect(() => {
    if (!workspace || scenario || recoveringScenario) return;
    const fallback =
      workspace.scenarios.find((s) => s.name.trim().toLowerCase() === "baseline") ??
      workspace.scenarios[0];
    if (!fallback) return;
    setRecoveringScenario(true);
    act("activate_scenario", { scenarioId: fallback.id })
      .catch(() => undefined)
      .finally(() => setRecoveringScenario(false));
  }, [workspace, scenario, recoveringScenario, act]);

  useEffect(() => {
    if (!highlightWeightsPanel) return;
    const el = weightsPanelRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlightWeightsPanel(false), 5000);
    return () => window.clearTimeout(timer);
  }, [highlightWeightsPanel, scenario?.id]);

  const result = useMemo(() => {
    if (!workspace || !scenario?.latestResultId) return undefined;
    return workspace.analysisResults.find((r) => r.id === scenario.latestResultId);
  }, [workspace, scenario?.latestResultId]);

  const hasAnyResult = Boolean(result);
  const isFreshResult = Boolean(result && result.status === "completed" && !result.stale);
  const candidates = result?.candidates ?? [];
  const completedAnalysisCount = result?.status === "completed" ? 1 : 0;
  const headerResumeNote = useMemo(() => {
    if (!workspace || !scenario) return undefined;
    if (scenario.decisionStatus === "approved" && !scenario.decisionStale) {
      return `Decision recorded: ${formatDecisionType("approve_scenario")}`;
    }
    if (scenario.decisionStatus === "rejected" && !scenario.decisionStale) {
      return `Decision recorded: ${formatDecisionType("reject_scenario")}`;
    }
    if (scenario.decisionStatus === "changes_requested") {
      return `Decision recorded: ${formatDecisionType("request_changes")}`;
    }
    if (isFreshResult && result) {
      return `Analysis complete — ${result.candidates.length} candidates (${scenario.name}).`;
    }
    if (!hasAnyResult) {
      return undefined;
    }
    return workspace.project.resumeNote;
  }, [workspace, scenario, result, isFreshResult, hasAnyResult]);
  const topCandidate = useMemo(() => {
    if (!result?.candidates.length) return null;
    return (
      result.candidates.find((c) => c.rank === 1) ??
      [...result.candidates].sort((a, b) => a.rank - b.rank)[0]
    );
  }, [result]);
  const shortlist = useMemo(
    () => (scenario ? resolveShortlist(scenario, result) : []),
    [scenario, result]
  );
  const shortlistedFeatureIds = useMemo(
    () => new Set(shortlist.flatMap((e) => e.featureIds)),
    [shortlist]
  );
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

  const copilotExclusionContext = useMemo(() => {
    if (drawMode === "exclude" && drawClicks.length >= 3 && scenario) {
      return {
        exclusionRing: drawClicks,
        exclusionLabel: uniqueGeographicLabel(
          scenario.geographicSelections,
          "exclusion",
          finishLabelDraft || undefined
        ),
        selectedParcel: null,
      };
    }
    if (selectedCandidate && drawMode === "none") {
      return {
        exclusionRing: null,
        exclusionLabel: null,
        selectedParcel: {
          featureIds: selectedCandidate.featureIds,
          label: selectedCandidate.label,
        },
      };
    }
    return { exclusionRing: null, exclusionLabel: null, selectedParcel: null };
  }, [
    drawMode,
    drawClicks,
    finishLabelDraft,
    scenario,
    selectedCandidate,
  ]);
  const decisionReason = scenario ? (decisionReasonByScenario[scenario.id] ?? "") : "";
  const runningJob = workspace?.analysisJobs.find(
    (j) => j.scenarioId === scenario?.id && j.status === "running"
  );
  const failedJob = useMemo(() => {
    if (!workspace || !scenario) return null;
    const latestFailed = [...workspace.analysisJobs]
      .reverse()
      .find((j) => j.scenarioId === scenario.id && j.status === "failed");
    if (!latestFailed) return null;
    const resultCompletedAt = result?.completedAt ?? result?.createdAt;
    if (
      result &&
      resultCompletedAt &&
      (latestFailed.completedAt ?? latestFailed.startedAt) < resultCompletedAt &&
      result.status === "completed" &&
      !result.stale
    ) {
      return null;
    }
    return latestFailed;
  }, [workspace?.analysisJobs, scenario?.id, result?.completedAt, result?.createdAt, result?.status, result?.stale]);

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
      const map: Record<string, GeoJSON.FeatureCollection> = {
        ...layerDataRef.current,
      };
      for (const [kind, fc] of entries) {
        if (fc) map[kind] = fc;
      }
      layerDataRef.current = map;
      setLayerData(map);
    });
  }, [workspace?.datasets]);

  useEffect(() => {
    if (!workspace?.project) return;
    trackRecentProject(workspace.project.id, workspace.project.name);
  }, [workspace?.project?.id, workspace?.project?.name]);

  useEffect(() => {
    if (!workspace?.project?.mapState.selectedCandidateId) return;
    if (!selectedCandidate || !result?.id) return;
    const prev = prevResultIdRef.current;
    if (prev && prev !== result.id) {
      setSelectionUpdated(true);
    }
    prevResultIdRef.current = result.id;
  }, [
    workspace?.project?.mapState.selectedCandidateId,
    selectedCandidate,
    result?.id,
  ]);

  useEffect(() => {
    if (!scenario) return;
    setCompareHint(null);
    setAnalysisProgress(null);
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
    if (tab !== "compare") {
      compareTabEnteredRef.current = false;
      return;
    }
    if (!workspace) return;
    const fromUrl = parseCompareScenarioIds(searchParams.get("compareScenarioIds"));
    if (fromUrl.length >= 2) {
      compareTabEnteredRef.current = true;
      setCompareIds(fromUrl);
      return;
    }
    if (compareTabEnteredRef.current) return;
    compareTabEnteredRef.current = true;
    setCompareIds(
      defaultCompareScenarioIds(
        workspace.scenarios,
        workspace.analysisResults,
        scenario?.id
      )
    );
  }, [tab, workspace, scenario?.id, searchParams]);

  useEffect(() => {
    if (!workspace || tab !== "compare") return;
    setCompareIds((prev) =>
      prev.filter((id) => {
        const item = workspace.scenarios.find((s) => s.id === id);
        return item && scenarioHasComparableAnalysis(item, workspace.analysisResults);
      })
    );
  }, [workspace, tab, workspace?.analysisResults.length]);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.undo ? 8000 : 3200;
    const t = setTimeout(() => setToast(null), duration);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const activeId = workspace?.project.activeScenarioId ?? scenario?.id;
    if (!activeId) return;
    setWebMcpBrowserContext({ projectId, scenarioId: activeId });
    return () => clearWebMcpBrowserContext(["projectId", "scenarioId"]);
  }, [projectId, workspace?.project.activeScenarioId, scenario?.id]);

  useEffect(() => {
    setPendingPlannerActions(listPendingPlannerActions(projectId));
    return onPlannerPending((detail) => {
      if (detail.projectId === projectId) {
        setPendingPlannerActions(detail.actions);
      }
    });
  }, [projectId]);

  useEffect(() => {
    const targetId = searchParams.get("scenarioId");
    if (!targetId || !workspace) return;
    if (!workspace.scenarios.some((s) => s.id === targetId)) return;
    if (workspace.project.activeScenarioId === targetId) return;
    void act("activate_scenario", { scenarioId: targetId }).catch(() => undefined);
  }, [searchParams, workspace?.project.activeScenarioId, workspace?.scenarios, act]);

  useEffect(() => {
    return onWorkspaceMutated((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      if (detail.activeScenarioId) {
        setWebMcpBrowserContext({ projectId, scenarioId: detail.activeScenarioId });
      }
      if (detail.criteriaStale) setCriteriaStaleHint(true);
      if (detail.resumeNote?.match(/stale|recalculate/i)) setCriteriaStaleHint(true);
      if (
        detail.tool === "exclude_map_area" ||
        detail.tool === "exclude_features"
      ) {
        setDrawMode("none");
        setDrawClicks([]);
        setEditingSelectionId(null);
        setShowFinishLabel(false);
        setFinishLabelDraft("");
        setCriteriaStaleHint(true);
      }
      if (detail.openTab === "compare" && detail.compareScenarioIds && detail.compareScenarioIds.length >= 2) {
        compareTabEnteredRef.current = true;
        const ids = detail.compareScenarioIds;
        if (detail.comparePayload) {
          applyCompareFromPayload(ids, detail.comparePayload);
        } else {
          setCompareIds(ids);
        }
        setTab("compare", { compareScenarioIds: ids });
        return;
      }
      if (detail.openTab === "decision") {
        setTab("decision");
        return;
      }
      if (detail.openTab === "report") {
        if (detail.reportId) setReportId(detail.reportId);
        setTab("report");
        return;
      }
      if (detail.openTab === "results") {
        setDrawerOpen(false);
        setDrawerPanel("candidates");
        setTab("results");
      }
      if (detail.tool === "run_analysis") {
        setCriteriaStaleHint(false);
        setDrawerOpen(true);
        setTab("results");
      }
    });
  }, [projectId, setTab, applyCompareFromPayload]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.altKey && !e.metaKey && !e.ctrlKey)) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const shortcut = WORKSPACE_TAB_KEYBOARD_SHORTCUTS.find((item) => item.key === e.key);
      if (!shortcut) return;
      e.preventDefault();
      setTab(shortcut.tab);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setTab]);

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

  const floodCoverageDetail = useMemo((): FloodCoverageDetail | null => {
    if (!workspace || !result) return null;
    const parcels = layerData.parcels?.features;
    return buildFloodCoverageDetail({
      datasets: workspace.datasets,
      result,
      parcels,
      floodLayer: layerData.flood,
    });
  }, [workspace, result, layerData.parcels, layerData.flood]);

  function showToast(
    message: string,
    undo?: () => void,
    action?: { label: string; onClick: () => void }
  ) {
    setToast({ message, undo, action });
  }

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

  const pinToShortlist = useCallback(
    async (c: Candidate, reason?: string) => {
      if (!scenario) return;
      setWorkspace((prev) =>
        prev
          ? applyShortlistMutation(prev, {
              action: "pin",
              candidateId: c.id,
              reason: reason ?? "Pinned from Results",
            })
          : prev
      );
      try {
        await act(
          "add_to_shortlist",
          {
            scenarioId: scenario.id,
            candidateId: c.id,
            reason: reason ?? "Pinned from Results",
          },
          { skipRefresh: true }
        );
      } catch {
        setWorkspace((prev) =>
          prev ? applyShortlistMutation(prev, { action: "unpin", candidateId: c.id }) : prev
        );
        showToast(SHORTLIST_SAVE_FAILED);
        return;
      }
      showToast(
        `Pinned ${c.label} to shortlist`,
        () => {
          setWorkspace((prev) =>
            prev ? applyShortlistMutation(prev, { action: "unpin", candidateId: c.id }) : prev
          );
          void act(
            "remove_from_shortlist",
            { scenarioId: scenario.id, candidateId: c.id },
            { skipRefresh: true }
          ).catch(() => {
            setWorkspace((prev) =>
              prev
                ? applyShortlistMutation(prev, {
                    action: "pin",
                    candidateId: c.id,
                    reason: reason ?? "Pinned from Results",
                  })
                : prev
            );
            showToast(SHORTLIST_SAVE_FAILED);
          });
        },
        {
          label: "Review decision",
          onClick: () => setTab("decision"),
        }
      );
    },
    [act, scenario, setTab, setWorkspace]
  );

  const unpinFromShortlist = useCallback(
    async (candidateId: string, label?: string) => {
      if (!scenario) return;
      const entry = shortlist.find((e) => e.candidateId === candidateId);
      const pinReason = entry?.reason ?? "Pinned from Results";
      const pinNote = entry?.note;
      setWorkspace((prev) =>
        prev ? applyShortlistMutation(prev, { action: "unpin", candidateId }) : prev
      );
      try {
        await act(
          "remove_from_shortlist",
          {
            scenarioId: scenario.id,
            candidateId,
          },
          { skipRefresh: true }
        );
      } catch {
        setWorkspace((prev) =>
          prev
            ? applyShortlistMutation(prev, {
                action: "pin",
                candidateId,
                reason: pinReason,
                note: pinNote,
              })
            : prev
        );
        showToast(SHORTLIST_SAVE_FAILED);
        return;
      }
      const displayLabel = label ?? entry?.candidate?.label ?? "site";
      showToast(`Removed ${displayLabel} from shortlist`, () => {
        void pinToShortlist(
          { id: candidateId, label: displayLabel } as Candidate,
          pinReason
        );
      });
    },
    [act, scenario, setWorkspace, shortlist]
  );

  const saveShortlistNote = useCallback(
    async (candidateId: string, note: string) => {
      if (!scenario) return;
      await act("update_shortlist_note", {
        scenarioId: scenario.id,
        candidateId,
        note,
      });
      await refresh();
    },
    [act, refresh, scenario]
  );

  const weightSum = useMemo(() => {
    const draft = weightDraft ?? scenario?.weights ?? [];
    return draft.reduce((sum, w) => sum + w.weight, 0) * 100;
  }, [weightDraft, scenario?.weights]);

  const weightSumRounded = Math.round(weightSum);

  const weightsDirty = useMemo(() => {
    if (!scenario || !weightDraft) return false;
    return !weightsEqual(weightDraft, scenario.weights);
  }, [weightDraft, scenario?.weights]);

  const prioritiesAwaitAnalysis = useMemo(() => {
    if (!hasAnyResult || !result) return false;
    return Boolean(
      result.stale && /weight|priorit/i.test(result.staleReason ?? "")
    );
  }, [hasAnyResult, result]);

  const housingTarget = useMemo(() => {
    if (!scenario || !workspace) return undefined;
    return resolveHousingTarget({
      intent: scenario.objective.intent,
      objectiveTarget: scenario.objective.targetValue,
      objectiveRawText: scenario.objective.rawText,
      projectName: workspace.project.name,
    });
  }, [
    scenario?.objective.intent,
    scenario?.objective.targetValue,
    scenario?.objective.rawText,
    workspace?.project.name,
  ]);
  const totalCapacity = totalCapacityFromResult(result);
  const topSiteCapacity = topSiteCapacityFromResult(result);
  const enabledDatasetCount =
    scenario?.enabledDatasetIds.filter((id) =>
      workspace?.datasets.some((d) => d.id === id && d.enabled)
    ).length ?? workspace?.datasets.filter((d) => d.enabled).length ?? 0;
  const accessHeadline =
    scenario && result
      ? headlineMetric(scenario.objective.intent, analysisAggregateMetrics(result), {
          limitations: result.limitations,
        })
      : null;
  const hasParksDataset = Boolean(workspace?.datasets.some((d) => d.kind === "parks" && d.enabled));
  const resultsColumns = scenario
    ? resultsColumnsForIntent(scenario.objective.intent, hasParksDataset)
    : [];

  const yieldGap = useMemo((): YieldGapSummary | null => {
    if (!housingTarget || !result?.candidates.length) return null;
    if (!isHousingIntent(scenario?.objective.intent ?? "housing_capacity")) return null;
    return computeYieldGap({
      target: housingTarget,
      candidates: result.candidates,
      shortlist,
    });
  }, [housingTarget, result?.candidates, scenario?.objective.intent, shortlist]);

  const housingGoalLine = useMemo(() => {
    if (!housingTarget || !result?.candidates.length) return null;
    return housingGoalSummary({
      target: housingTarget,
      totalCapacity,
      targetGapMetric: analysisAggregateMetrics(result).find((m) => m.key === "housing_target_gap"),
      candidateCount: result.candidates.length,
      topSiteCapacity,
    });
  }, [housingTarget, result, totalCapacity, topSiteCapacity]);

  const shortlistedIdsForFilter = useMemo(
    () => new Set(shortlist.map((e) => e.candidateId).filter(Boolean) as string[]),
    [shortlist]
  );
  const filteredMapCandidates = useMemo(
    () =>
      filterCandidates(candidates, resultsFilter, shortlistedIdsForFilter, {
        housingTarget,
      }),
    [candidates, resultsFilter, shortlistedIdsForFilter, housingTarget]
  );

  useEffect(() => {
    setResultsFilter(DEFAULT_RESULTS_FILTER);
  }, [scenario?.id]);

  const analyzedScenarios = useMemo(() => {
    if (!workspace) return [];
    return workspace.scenarios.filter((s) =>
      scenarioHasComparableAnalysis(s, workspace.analysisResults)
    );
  }, [workspace]);

  const resolvedShortlistCount = useMemo(
    () => shortlist.filter((entry) => entry.candidate && !entry.missing).length,
    [shortlist]
  );

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
    const scenarioId = scenarioIdForActions();
    if (!scenarioId) return;
    setTab("workspace");
    setAnalysisBusy(true);
    const steps = scenario?.analysisPlan?.steps.length ?? 4;
    setAnalysisProgress(`Running analysis (0/${steps} steps)…`);
    try {
      await act("run_analysis", { scenarioId });
      setCriteriaStaleHint(false);
      setTab("results");
      showToast("Analysis complete — results updated.");
    } catch {
      showToast("Analysis could not complete — check the error banner and retry.");
    } finally {
      setAnalysisBusy(false);
      setAnalysisProgress(null);
    }
  }

  async function exportMapImage() {
    if (exportingMap) return;
    setExportingMap(true);
    try {
      const container = document.querySelector(".leaflet-container") as HTMLElement | null;
      const { captureMapPng } = await import("@/components/PlanningMap");
      const safeName = (workspace?.project.name ?? "map").replace(/[^\w.-]+/g, "-");
      const ok = await captureMapPng(container, `${safeName}-workspace.png`);
      if (ok) {
        showToast("Map exported as PNG — check your Downloads folder.");
      } else {
        showToast("Map export failed — try again after tiles finish loading.");
      }
    } finally {
      setExportingMap(false);
    }
  }

  async function applyWeights() {
    if (!scenario || !weightDraft || weightSumRounded !== 100 || !weightsDirty) return;
    await act("update_weights", { scenarioId: scenario.id, weights: weightDraft });
  }

  function scenarioDisplayStatus(
    s: NonNullable<typeof scenario>,
    scResult?: AnalysisResult
  ): string {
    if (scResult?.status === "completed" && !scResult.stale) return "analyzed";
    if (s.status === "saved") return "ready";
    return s.status;
  }

  function scenarioStatusLabel(): string {
    if (runningJob) return runningJob.currentStep ?? "Analysis running…";
    if (failedJob) return failedJob.error ?? "Analysis failed — retry run_analysis.";
    if (isFreshResult && result) {
      return `Analysis complete — ${result.candidates.length} candidates`;
    }
    if (hasAnyResult && result && (result.stale || result.status === "stale")) {
      return `Results stale — ${result.candidates.length} candidates from last run (recalculate to apply changes)`;
    }
    return EMPTY_ANALYSIS_STATUS;
  }

  function adjustWeightDraft(changedIndex: number, newPercent: number) {
    const base = weightDraft ?? scenario?.weights ?? [];
    setWeightDraft(rebalanceWeights(base, changedIndex, newPercent));
  }

  async function commitTransitThreshold(constraintId: string, rawText: string) {
    if (!scenario) return;
    const parsed = Number(rawText.replace(/,/g, "").trim());
    if (!Number.isFinite(parsed)) {
      setTransitThresholdWarning("Enter a whole number of meters between 100 and 2000.");
      return;
    }
    const normalized = normalizeTransitThresholdMeters(parsed);
    setTransitThresholdWarning(normalized.warning ?? null);
    setTransitDraftText((prev) => ({
      ...prev,
      [constraintId]: String(normalized.meters),
    }));
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
    try {
      await act("update_constraints", { scenarioId: scenario.id, constraints });
      if (normalized.adjusted || normalized.warning) {
        showToast(normalized.warning ?? `Transit threshold set to ${normalized.meters}m`);
      }
    } catch {
      setTransitDraftText((prev) => ({
        ...prev,
        [constraintId]: String(Number(scenario.constraints.find((c) => c.id === constraintId)?.value ?? normalized.meters)),
      }));
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
      const scenarioId = scenarioIdForActions();
      if (!scenarioId) return;
      setGeoSaving(true);
      try {
        await act("update_geo_selection", {
          scenarioId,
          selectionId: editingSelectionId,
          patch: { geometry: polygonFromRing(drawClicks) },
        });
        setCriteriaStaleHint(true);
        showToast("Geographic area updated — recalculate to apply.");
        cancelDrawing();
      } finally {
        setGeoSaving(false);
      }
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
    const scenarioId = scenarioIdForActions();
    if (!scenarioId) return;
    const label = uniqueGeographicLabel(
      scenario.geographicSelections,
      drawMode === "include" ? "inclusion" : "exclusion",
      finishLabelDraft
    );
    setGeoSaving(true);
    try {
      await act("add_geo_selection", {
        scenarioId,
        selection: {
          type: drawMode === "include" ? "inclusion" : "exclusion",
          label,
          geometry: polygonFromRing(drawClicks),
          createdBy: "human",
        },
      });
      setCriteriaStaleHint(true);
      showToast(`${drawMode === "include" ? "Inclusion" : "Exclusion"} "${label}" added — recalculate.`);
      cancelDrawing();
    } finally {
      setGeoSaving(false);
    }
  }

  async function removeGeographicSelection(selectionId: string) {
    if (!scenario) return;
    const scenarioId = scenarioIdForActions();
    if (!scenarioId) return;
    const sel = scenario.geographicSelections.find((s) => s.id === selectionId);
    setGeoSaving(true);
    try {
      await act("remove_geo_selection", { scenarioId, selectionId });
      if (editingSelectionId === selectionId) cancelDrawing();
      setCriteriaStaleHint(true);
      showToast(
        sel
          ? `Removed "${sel.label}" — recalculate to restore excluded candidates.`
          : "Geographic area removed — recalculate."
      );
    } finally {
      setGeoSaving(false);
    }
  }

  async function renameGeographicSelection(selectionId: string, label: string) {
    if (!scenario || !label.trim()) return;
    await act("update_geo_selection", {
      scenarioId: scenario.id,
      selectionId,
      patch: { label: label.trim() },
    });
    setRenamingExclusionId(null);
    showToast("Geographic area renamed.");
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
    setDuplicateBusy(true);
    try {
      await act("create_scenario", { name, fromScenarioId: scenario.id });
      setCriteriaStaleHint(true);
      setDuplicateDialogOpen(false);
      const floodNote = isFloodWeightedBranchName(name)
        ? " Flood weights were increased — run analysis on this branch to compare."
        : " Adjust weights and run analysis on this branch.";
      showToast(`Created "${name}" — now viewing the new branch.${floodNote}`);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Could not duplicate scenario — try again."
      );
    } finally {
      setDuplicateBusy(false);
    }
  }

  function openDuplicateDialog() {
    if (!workspace || !scenario) return;
    setDuplicateNameDraft(`Branch ${workspace.scenarios.length + 1}`);
    setDuplicateDialogOpen(true);
  }

  async function confirmDuplicateScenario() {
    const trimmed = duplicateNameDraft.trim();
    if (trimmed.length < 2) {
      showToast("Scenario name must be at least 2 characters.");
      return;
    }
    await duplicateScenario(trimmed);
  }

  async function activateScenario(scenarioId: string) {
    if (!scenario || scenario.id === scenarioId) return;
    try {
      await act("activate_scenario", { scenarioId });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not switch scenario.");
    }
  }

  async function saveScenario() {
    if (!scenario) return;
    await act("save_scenario", { scenarioId: scenario.id });
    showToast(`Scenario "${scenario.name}" saved`);
  }

  if (loading) {
    return (
      <WorkspaceLoadingSkeleton
        phase={loadPhase}
        elapsedMs={elapsedMs}
        isRetrying={isRetrying}
      />
    );
  }

  if (!loading && !workspace) {
    const notFoundTitle = projectNotFound
      ? "This project is no longer on the server"
      : "This project is not available";
    const notFoundDetail = projectNotFound
      ? PROJECT_NOT_ON_SERVER_DETAIL
      : error
        ? ` ${error}`
        : PROJECT_UNAVAILABLE_DETAIL;
    return (
      <div className="h-screen flex flex-col bg-background">
        <ServerWakeBanner />
      <StorageBanner />
        <header className="bg-surface-container-high border-b border-outline-variant px-section-padding h-14 flex items-center">
          <Link href="/" className="font-display text-[18px] font-semibold text-primary">
            Urban Planning Copilot
          </Link>
        </header>
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg text-center border border-outline-variant bg-surface-container-lowest p-10">
            <h1 className="text-headline-md text-on-surface mb-3">{notFoundTitle}</h1>
            <p className="text-body-sm text-on-surface-variant mb-2">
              The server could not load project <span className="font-mono text-caption">{projectId}</span>.
              {notFoundDetail}
            </p>
            {lastFetchAt && (
              <p className="font-mono text-caption text-on-surface-variant mb-4">
                Last checked {new Date(lastFetchAt).toLocaleString()}
              </p>
            )}
            <p className="text-body-sm text-on-surface-variant mb-6">
              {PROJECT_NOT_FOUND_HELP}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
              >
                {refreshing && (
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                )}
                Retry load
              </button>
              <Link
                href="/"
                className="border border-outline-variant px-5 py-2.5 rounded text-body-sm"
              >
                Home
              </Link>
              <Link
                href="/new"
                className="text-primary text-body-sm hover:underline py-2.5"
              >
                New project
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (workspace && !scenario && !recoveringScenario) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <ServerWakeBanner />
      <StorageBanner />
        <header className="bg-surface-container-high border-b border-outline-variant px-section-padding h-14 flex items-center">
          <Link href="/" className="font-display text-[18px] font-semibold text-primary">
            Urban Planning Copilot
          </Link>
        </header>
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg text-center border border-outline-variant bg-surface-container-lowest p-10">
            <h1 className="text-headline-md text-on-surface mb-3">Restoring active scenario…</h1>
            <p className="text-body-sm text-on-surface-variant mb-4">
              Project <span className="font-mono text-caption">{workspace.project.name}</span> loaded
              but no valid active scenario was set. Switching to Baseline or the first remaining
              scenario.
            </p>
            {workspace.scenarios.length > 0 && (
              <div className="space-y-2 mb-6 text-left">
                <p className="text-caption text-on-surface-variant">Or choose manually:</p>
                {workspace.scenarios.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void activateScenario(s.id)}
                    className="w-full text-left px-3 py-2 border border-outline-variant rounded text-body-sm hover:bg-surface-container"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => void refresh()}
                className="bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium"
              >
                Retry load
              </button>
              <Link href="/" className="text-primary text-body-sm hover:underline py-2.5">
                Back to projects
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (recoveringScenario || (workspace && !scenario)) {
    return (
      <div className="h-screen flex flex-col bg-background items-center justify-center gap-3 text-body-sm text-on-surface-variant">
        <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
        Restoring scenario…
      </div>
    );
  }

  if (!workspace || !scenario) {
    return null;
  }

  const activeActivity = workspace.activities.find((a) => a.id === activityId);
  const titleObjectiveMismatch = objectiveTitleMismatchWarning(
    workspace.project.name,
    housingTarget
  );
  const rankingStale =
    rankingStaleVersusObjective(result, housingTarget) && !result?.stale;
  const rankingStaleLabel =
    rankingStale && housingTarget != null
      ? rankingStaleMessage(housingTarget, analyzedHousingTarget(result) ?? housingTarget)
      : RANKING_STALE_FALLBACK;
  const inspectorOutcome = outcomeFromWorkspace(
    workspace,
    scenario.id,
    listCopilotActivity()
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background relative">
      <ServerWakeBanner />
      <StorageBanner />
      <header className="bg-surface-container-high border-b border-outline-variant shrink-0 z-50">
        <div className="flex items-center justify-between gap-4 px-section-padding h-14 min-w-0">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <Link
              href="/"
              className="font-display text-[18px] font-semibold text-primary shrink-0 hidden sm:block"
            >
              Urban Planning Copilot
            </Link>
            <nav
              className="flex items-center gap-1.5 text-body-sm min-w-0 flex-wrap leading-snug"
              aria-label="Workspace location"
            >
              <Link href="/" className="text-on-surface-variant hover:text-primary shrink-0">
                Projects
              </Link>
              <span className="text-outline-variant shrink-0">/</span>
              <span
                className="text-on-surface font-medium min-w-0"
                title={workspace.project.name}
              >
                {workspace.project.name}
              </span>
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[10px] uppercase text-on-surface-variant shrink-0">
                Scenario
              </span>
              {workspace.scenarios.length > 1 ? (
                <select
                  value={scenario.id}
                  onChange={(e) => void activateScenario(e.target.value)}
                  className="text-body-sm font-medium max-w-[12rem] sm:max-w-[16rem] border border-outline-variant rounded px-2 py-1.5 bg-surface focus-ring"
                  title="Switch scenario branch"
                  aria-label="Active scenario"
                >
                  {workspace.scenarios.map((s) => {
                    const analyzed = scenarioHasComparableAnalysis(s, workspace.analysisResults);
                    return (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {analyzed ? "" : " — no results yet"}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <span className="text-body-sm font-medium text-on-surface" title={scenario.name}>
                  {scenario.name}
                </span>
              )}
            </label>
            {resolvedShortlistCount > 0 && (
              <span
                className="shrink-0 px-2 py-0.5 rounded border border-[#815504]/50 text-[#815504] text-caption"
                title={`Shortlist pins for scenario “${scenario.name}”`}
              >
                Shortlist: {resolvedShortlistCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-section-padding py-1 border-t border-outline-variant/60 bg-surface-container-low">
          <nav
            className="flex items-center gap-0.5 overflow-x-auto workspace-tab-scroll flex-1 min-w-0"
            aria-label="Workspace views"
          >
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
                aria-current={tab === t ? "page" : undefined}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1.5 rounded transition-colors flex items-center gap-1.5 shrink-0 focus-ring ${
                  tab === t
                    ? "bg-surface text-on-surface font-medium border border-outline-variant"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface/80"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{icon}</span>
                <span className="text-caption hidden lg:inline">{TAB_LABELS[t]}</span>
              </button>
            ))}
          </nav>
          <button
            onClick={() => saveScenario()}
            className="px-2.5 py-1.5 hover:bg-surface rounded text-caption flex items-center gap-1 shrink-0 focus-ring text-on-surface-variant hover:text-on-surface"
            title="Save scenario"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
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
                    showToast(`Approved: ${pending.tool.replace(/_/g, " ")}`);
                    await refresh();
                  } catch (e) {
                    showToast(e instanceof Error ? e.message : String(e));
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
                    showToast("Agent action rejected");
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
          <span className="font-mono text-[10px] uppercase text-on-surface-variant">
            Planning objective
          </span>
          <span className="text-outline-variant">·</span>
          <span className="font-medium truncate">
            {housingTarget
              ? `${housingTarget.toLocaleString()} ${scenario.objective.targetUnit ?? "additional homes"}`
              : scenario.objective.targetValue
                ? `${scenario.objective.targetValue.toLocaleString()} ${scenario.objective.targetUnit ?? ""}`
                : scenario.objective.rawText.length > 72
                  ? `${scenario.objective.rawText.slice(0, 69)}…`
                  : scenario.objective.rawText}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap min-w-0">
          {scenario.constraints
            .filter((c) => c.enabled)
            .slice(0, 4)
            .map((c) => (
            <span
              key={c.id}
              className="px-2 py-0.5 border border-outline rounded text-caption text-on-surface-variant whitespace-nowrap inline-flex items-center gap-1"
              title={c.hard ? "Hard constraint (engine-enforced)" : "Soft constraint"}
            >
              <span className="material-symbols-outlined text-[14px]">
                {constraintChipIcon(c.label, c.datasetKind)}
              </span>
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
              (yieldGap?.shortfall ?? 0) > 0 || totalCapacity < housingTarget
                ? "border-error bg-error-container/30 text-error"
                : "border-secondary bg-secondary-fixed/20 text-secondary"
            }`}
          >
            {yieldGap?.headline ??
              (totalCapacity >= housingTarget
                ? `Eligible capacity ${totalCapacity.toLocaleString()} vs ${housingTarget.toLocaleString()} target`
                : `Shortfall of ${(housingTarget - totalCapacity).toLocaleString()} homes (${totalCapacity.toLocaleString()} eligible / ${housingTarget.toLocaleString()} target)`)}
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
        {hasAnyResult && !isFreshResult && !runningJob && !failedJob && (
          <span className="shrink-0 text-caption text-on-surface-variant">
            {scenarioStatusLabel()}
          </span>
        )}
        {failedJob && (
          <span className="shrink-0 px-3 py-1 rounded border border-error bg-error-container/30 text-error text-caption font-medium whitespace-nowrap">
            Analysis failed — retry
          </span>
        )}
        {(result?.stale || criteriaStaleHint) && !failedJob && (
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
        {headerResumeNote && !result?.stale && !criteriaStaleHint && (
          <span className="text-caption text-on-surface-variant truncate max-w-md ml-auto">
            {headerResumeNote}
          </span>
        )}
        {rankingStale && (
          <span
            className="shrink-0 px-3 py-1 rounded border border-secondary bg-secondary-fixed/20 text-secondary text-caption font-medium whitespace-nowrap"
            title={rankingStaleLabel}
          >
            Ranking stale — recalculate
          </span>
        )}
        {titleObjectiveMismatch && (
          <span
            className="shrink-0 px-2 py-0.5 rounded border border-secondary text-secondary text-caption whitespace-nowrap"
            title={titleObjectiveMismatch}
          >
            Title vs objective mismatch
          </span>
        )}
      </div>

      {rankingStale && (
        <div className="bg-secondary-fixed/15 border-b border-secondary/30 px-section-padding py-2 text-caption text-secondary shrink-0">
          {rankingStaleLabel}
        </div>
      )}
      {titleObjectiveMismatch && (
        <div className="bg-secondary-fixed/15 border-b border-secondary/30 px-section-padding py-2 text-caption text-secondary shrink-0">
          {titleObjectiveMismatch}
        </div>
      )}

      {error && workspace && (
        <div className="bg-error-container text-on-error-container px-4 py-2 text-body-sm flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              clearError();
              void refresh().catch(() => undefined);
            }}
            className="underline text-body-sm"
          >
            Retry
          </button>
        </div>
      )}

      {isFreshResult && topCandidate && !runningJob && (
        <div className="bg-surface-container-low border-b border-outline-variant px-section-padding py-2.5 flex flex-wrap items-center gap-3 text-body-sm shrink-0">
          <span className="text-on-surface">
            Analysis complete — {result!.candidates.length} candidates.
          </span>
          <div className="flex flex-wrap gap-2">
            {tab !== "results" && (
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  setDrawerPanel("candidates");
                  setTab("results");
                }}
                className="bg-primary text-on-primary px-3 py-1.5 rounded text-caption font-medium focus-ring"
              >
                View results
              </button>
            )}
            <button
              type="button"
              onClick={() => void selectCandidate(topCandidate, "evidence")}
              className="border border-outline-variant px-3 py-1.5 rounded text-caption focus-ring"
            >
              Inspect top site
            </button>
            {workspace.scenarios.length > 1 && (
              <button
                type="button"
                onClick={() => setTab("compare")}
                className="border border-outline-variant px-3 py-1.5 rounded text-caption focus-ring"
              >
                Compare scenarios
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab("decision")}
              className="border border-outline-variant px-3 py-1.5 rounded text-caption focus-ring"
            >
              Record decision
            </button>
          </div>
        </div>
      )}

      {tab === "workspace" ? (
        <main className="flex-1 flex overflow-hidden relative min-h-0">
          <aside className="w-[min(360px,28vw)] min-w-[220px] max-w-sidebar-width bg-surface border-r border-outline-variant flex flex-col z-30 shrink-0 min-h-0">
            <div className="p-4 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
              <div>
                <h2 className="text-headline-md text-primary">Plan</h2>
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
                {housingTarget != null && isHousingIntent(scenario.objective.intent) && (
                  <p className="text-body-sm font-medium text-primary mt-2">
                    Housing target: {housingTarget.toLocaleString()} homes
                  </p>
                )}
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
                  <div className="rounded border border-dashed border-outline-variant p-3 bg-surface-container-lowest">
                    <button
                      type="button"
                      onClick={() => startDraw("exclude")}
                      disabled={drawingActive && drawMode !== "exclude"}
                      className="inline-flex items-center gap-2 text-body-sm text-primary font-medium hover:underline disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">block</span>
                      Exclude this area
                    </button>
                    <p className="text-caption text-on-surface-variant mt-1">
                      Click map corners, then Finish. Edit or delete a polygon from the list below without fighting the map — drawing mode ignores parcel clicks.
                    </p>
                  </div>
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
                                setTransitDraftText((prev) =>
                                  prev[c.id] !== undefined
                                    ? prev
                                    : { ...prev, [c.id]: String(Number(c.value)) }
                                );
                              }}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/[^\d]/g, "");
                                setTransitDraftText((prev) => ({ ...prev, [c.id]: digits }));
                                setTransitThresholdWarning(null);
                              }}
                              onBlur={(e) => {
                                void commitTransitThreshold(c.id, e.target.value);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void commitTransitThreshold(
                                    c.id,
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

              <section
                ref={weightsPanelRef}
                className={
                  highlightWeightsPanel
                    ? "rounded border-2 border-primary bg-primary-fixed/10 p-3 -mx-1 shadow-sm"
                    : undefined
                }
              >
                <div className="flex justify-between mb-3">
                  <h3 className="font-mono text-data-label text-on-surface-variant uppercase">
                    Priorities
                  </h3>
                  <button
                    onClick={applyWeights}
                    className="text-caption text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                    disabled={busy || weightSumRounded !== 100 || !weightsDirty}
                    title={
                      weightSumRounded !== 100
                        ? "Priorities must sum to 100% before applying"
                        : !weightsDirty
                          ? "No unsaved priority changes"
                          : undefined
                    }
                  >
                    Apply priorities
                  </button>
                </div>
                <p className="text-caption text-on-surface-variant mb-3" role="note">
                  Rankings on this branch only change after you run analysis — adjusting sliders
                  updates the draft until you apply.
                </p>
                {highlightWeightsPanel && (
                  <p className="text-body-sm text-primary mb-3" role="status">
                    {isFloodWeightedBranchName(scenario.name)
                      ? "Flood-weighted branch — priorities were shifted toward flood resilience. Run analysis to see a new ranking."
                      : "New scenario branch — change priority weights here before running analysis."}
                  </p>
                )}
                {!hasAnyResult && (
                  <p className="text-caption text-on-surface-variant mb-3" role="status">
                    No analysis on this branch yet — apply priorities when ready, then run analysis
                    to generate rankings.
                  </p>
                )}
                {weightsDirty && (
                  <p className="text-caption text-secondary mb-3" role="status">
                    Unsaved priority changes — apply priorities, then run analysis to update
                    rankings.
                  </p>
                )}
                {prioritiesAwaitAnalysis && !weightsDirty && (
                  <p className="text-caption text-secondary mb-3" role="status">
                    Priorities saved — run analysis to update rankings.
                  </p>
                )}
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
                          type="button"
                          onClick={() => void activateScenario(s.id)}
                          aria-current={s.id === scenario.id ? "true" : undefined}
                          className={`w-full text-left px-2 py-1.5 text-body-sm rounded border ${
                            s.id === scenario.id
                              ? "border-primary bg-primary-fixed/30"
                              : "border-outline-variant hover:bg-surface-container"
                          }`}
                        >
                          <span className="font-medium">{s.name}</span>
                          <span className="text-caption text-on-surface-variant ml-2">
                            · {scenarioDisplayStatus(s, scResult)}
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
                    type="button"
                    onClick={() => openDuplicateDialog()}
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

          <section className="flex-1 relative bg-surface-container-low min-w-0 overflow-visible">
            <PlanningMap
              workspace={workspace}
              layerData={layerData}
              candidates={filteredMapCandidates}
              shortlistedFeatureIds={shortlistedFeatureIds}
              hideEmptyState
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

            {selectedCandidate && !drawingActive && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1002] pointer-events-auto">
                <div className="glass-panel border border-outline-variant rounded px-2 py-1.5 flex items-center gap-1.5 shadow-sm">
                  <span className="font-mono text-[11px] text-on-surface px-1">
                    {selectedCandidate.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => void selectCandidate(selectedCandidate, "evidence")}
                    className="glass-panel border border-outline-variant rounded px-2 py-1 text-caption inline-flex items-center gap-1 hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-[14px]">visibility</span>
                    Inspect
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void act("exclude_features", {
                        scenarioId: scenario.id,
                        featureIds: selectedCandidate.featureIds,
                        label: `Exclude ${selectedCandidate.label}`,
                      })
                    }
                    className="glass-panel border border-error/40 rounded px-2 py-1 text-caption text-error inline-flex items-center gap-1 hover:bg-error-container/20"
                  >
                    <span className="material-symbols-outlined text-[14px]">block</span>
                    Exclude
                  </button>
                  <button
                    type="button"
                    onClick={() => startDraw("include")}
                    className="glass-panel border border-primary/40 rounded px-2 py-1 text-caption text-primary inline-flex items-center gap-1 hover:bg-primary-fixed/15"
                  >
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    Include
                  </button>
                </div>
              </div>
            )}

            <div
              className="absolute right-3 top-14 flex flex-col gap-2 z-[1000] max-h-[calc(100%-6.5rem)] overflow-y-auto overflow-x-visible"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  if (drawMode === "exclude") cancelDrawing();
                  else startDraw("exclude");
                }}
                className={`glass-panel px-2.5 py-1.5 rounded border border-outline-variant pointer-events-auto flex items-center gap-1.5 ${
                  drawMode === "exclude" ? "bg-error-container" : ""
                }`}
                title="Draw exclusion polygon on the map"
                aria-label="Exclude this area — draw polygon on map"
                aria-pressed={drawMode === "exclude"}
              >
                <span className="material-symbols-outlined text-[18px]">block</span>
                <span className="text-[10px] font-mono uppercase whitespace-nowrap">
                  {drawMode === "exclude" ? "Drawing…" : "Exclude area"}
                </span>
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
              <button
                type="button"
                onClick={() => void exportMapImage()}
                disabled={exportingMap}
                className="glass-panel px-2.5 py-1.5 rounded border border-outline-variant text-[10px] font-mono uppercase text-on-surface-variant disabled:opacity-50 pointer-events-auto"
                title="Export map as PNG"
              >
                {exportingMap ? "Exporting…" : "Export PNG"}
              </button>
              <button
                type="button"
                onClick={() => setLegendOpen((v) => !v)}
                className="glass-panel p-2 rounded border border-outline-variant pointer-events-auto text-on-surface-variant"
                aria-expanded={legendOpen}
                aria-label={legendOpen ? "Hide map legend" : "Show map legend"}
                title="Map legend"
              >
                <span className="material-symbols-outlined text-[18px]">legend</span>
              </button>
              {legendOpen && (
                <div className="glass-panel p-2 rounded border border-outline-variant pointer-events-auto max-h-48 overflow-y-auto">
                  <MapLegend
                    compact
                    visibleKinds={visibleLayerKinds}
                    hasExclusions={scenario.geographicSelections.some(
                      (g) => g.type === "exclusion"
                    )}
                    hasFloodCoverageGaps={Boolean(
                      workspace.datasets.find((d) => d.kind === "flood")?.incompleteCoverage
                    )}
                  />
                </div>
              )}
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
              {geoSaving && (
                <span className="glass-panel px-2 py-1 rounded border border-outline-variant text-[10px] font-mono text-on-surface-variant flex items-center gap-1 pointer-events-auto">
                  <span className="material-symbols-outlined animate-spin text-[12px]">progress_activity</span>
                  Saving area…
                </span>
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
              className={`absolute bottom-7 left-1/2 -translate-x-1/2 z-[1010] ${
                drawingActive ? "pointer-events-none" : "pointer-events-auto"
              }`}
            >
              <button
                type="button"
                onClick={() => setTab("results")}
                className="bg-surface border-t border-l border-r border-outline-variant rounded-t-xl px-6 py-1 flex flex-col items-center hover:bg-surface-container-low"
              >
                <div className="w-8 h-1 bg-outline-variant rounded-full mb-1" />
                <span className="font-mono text-data-label text-on-surface-variant">
                  Analysis results ({candidates.length})
                </span>
                {shortlist.length > 0 && (
                  <span className="font-mono text-[10px] uppercase mt-0.5 px-2 py-0.5 rounded border border-[#815504] text-[#815504]">
                    Shortlist: {shortlist.length}
                  </span>
                )}
              </button>
            </div>
          </section>

          <aside
            id="agent-activity-panel"
            className={`w-[min(320px,26vw)] min-w-[200px] max-w-inspector-width bg-surface border-l border-outline-variant flex flex-col z-30 shrink-0 min-h-0 ${
              runningJob || analysisBusy ? "copilot-running-glow" : ""
            }`}
          >
            <div className="p-3 border-b border-outline-variant bg-surface-container-low shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-body-sm font-medium text-on-surface flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        runningJob || analysisBusy
                          ? "bg-primary-container animate-pulse"
                          : "bg-outline-variant"
                      }`}
                      aria-hidden
                    />
                    Findings
                  </h2>
                  <p className="text-caption text-on-surface-variant mt-0.5 line-clamp-2">
                    {inspectorOutcome}
                  </p>
                </div>
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">
                  smart_toy
                </span>
              </div>
              {(runningJob || analysisBusy) && (
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    disabled
                    title="Pause is not available while analysis is running"
                    className="flex-1 border border-outline-variant px-2 py-1 rounded text-caption text-on-surface-variant opacity-50"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAnalysisBusy(false);
                      setAnalysisProgress(null);
                      showToast("Analysis continues on the server — refresh to check status.");
                    }}
                    className="flex-1 border border-outline-variant px-2 py-1 rounded text-caption hover:bg-surface-container"
                  >
                    Stop tracking
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
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
                        Agent logic feed
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
                    Findings
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

              <CopilotActivityFeed limit={5} className="pt-2" />
            </div>

            <UrbanPlanningCopilot
              projectId={projectId}
              scenarioId={scenario.id}
              scenarioCount={workspace.scenarios.length}
              analyzedScenarioCount={analyzedScenarios.length}
              unanalyzedScenarioName={
                scenario && !scenarioHasComparableAnalysis(scenario, workspace.analysisResults)
                  ? scenario.name
                  : firstUnanalyzedScenarioName(workspace.scenarios, workspace.analysisResults)
              }
              scenarioIds={workspace.scenarios.map((s) => s.id)}
              analyzedScenarioIds={analyzedScenarios.map((s) => s.id)}
              topCandidateId={topCandidate?.id}
              topCandidateLabel={topCandidate?.label}
              exclusionRing={copilotExclusionContext.exclusionRing}
              exclusionLabel={copilotExclusionContext.exclusionLabel}
              selectedParcel={copilotExclusionContext.selectedParcel}
              variant="sidebar"
              showActivityFeed={false}
              commandOnly
              onToolComplete={async () => {
                await refresh();
              }}
            />

            <div className="p-4 border-t border-outline-variant bg-surface-container-lowest flex flex-col gap-3 shrink-0">
              {assumptionsOpen && (
                <div className="border border-outline-variant bg-surface-container-low p-4 max-h-[40vh] overflow-y-auto rounded">
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
              <div className="font-mono text-[11px] text-on-surface-variant flex justify-center gap-2">
                <span>{enabledDatasetCount} DATASETS</span>·
                <span>
                  {scenario.constraints.filter((c) => c.enabled).length} CONSTRAINTS
                </span>
                ·
                <span>{completedAnalysisCount} ANALYSES</span>
              </div>
              <button
                onClick={runAnalysis}
                disabled={busy || analysisBusy}
                className="w-full bg-primary-container hover:bg-on-primary-fixed-variant text-on-primary font-medium py-2 px-4 rounded flex justify-center items-center gap-2 disabled:opacity-50"
              >
                {(analysisBusy || (busy && analysisProgress)) && (
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                )}
                {!analysisBusy && !(busy && analysisProgress) && (
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                )}
                {analysisBusy || (busy && analysisProgress)
                  ? "Running…"
                  : result
                    ? "Recalculate"
                    : "Run analysis"}
              </button>
              {(runningJob || analysisBusy || (busy && analysisProgress)) && (
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-inverse-surface text-inverse-on-surface px-4 py-2 rounded shadow-lg text-body-sm flex items-center gap-3 max-w-[min(92vw,28rem)]">
          <span className="flex-1">{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="underline font-medium shrink-0"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
          {toast.action && (
            <button
              type="button"
              className="underline font-medium shrink-0"
              onClick={() => {
                toast.action?.onClick();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="text-inverse-on-surface/80 hover:text-inverse-on-surface shrink-0"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {duplicateDialogOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-scenario-title"
        >
          <div className="bg-surface max-w-md w-full rounded-lg border border-outline-variant p-6 shadow-xl">
            <h4 id="duplicate-scenario-title" className="text-headline-md mb-2">
              Duplicate scenario
            </h4>
            <p className="text-body-sm text-on-surface-variant mb-4">
              Create a named copy of <strong>{scenario.name}</strong> to explore alternatives
              (e.g. flood-weight sensitivity). The copy starts without results — run analysis when
              ready.
            </p>
            <label className="block mb-4">
              <span className="font-mono text-data-label uppercase text-on-surface-variant">
                Scenario name
              </span>
              <input
                type="text"
                value={duplicateNameDraft}
                onChange={(e) => setDuplicateNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmDuplicateScenario();
                  if (e.key === "Escape") setDuplicateDialogOpen(false);
                }}
                className="mt-2 w-full border border-outline-variant rounded px-3 py-2 text-body-sm"
                autoFocus
              />
            </label>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setDuplicateDialogOpen(false)}
                className="border border-outline-variant px-4 py-2 rounded text-body-sm"
                disabled={duplicateBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDuplicateScenario()}
                disabled={duplicateBusy}
                className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-50"
              >
                {duplicateBusy ? "Duplicating…" : "Duplicate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {drawerOpen && tab === "workspace" ? (
        <ResultsDrawer
          layout="drawer"
          open={drawerOpen}
          panel={drawerPanel}
          onPanelChange={setDrawerPanel}
          onClose={() => setDrawerOpen(false)}
          drawingActive={drawingActive}
          result={result}
          stale={Boolean(result?.stale)}
          selected={selectedCandidate}
          shortlist={shortlist}
          scenario={scenario}
          datasets={workspace.datasets}
          onInspectDataset={(datasetId) => openDatasetInspect(datasetId)}
          floodCoverageDetail={floodCoverageDetail}
          yieldGap={yieldGap}
          housingGoalLine={housingGoalLine}
          onStartExcludeDraw={() => startDraw("exclude")}
          onInspectFloodDataset={() => {
            const flood = workspace.datasets.find((d) => d.kind === "flood");
            if (flood) openDatasetInspect(flood.id);
          }}
          housingTarget={housingTarget}
          totalCapacity={totalCapacity}
          intent={scenario.objective.intent}
          resultsColumns={resultsColumns}
          accessHeadline={accessHeadline}
          selectionUpdated={selectionUpdated}
          onDismissUpdated={() => setSelectionUpdated(false)}
          focusedRowIndex={focusedRowIndex}
          setFocusedRowIndex={setFocusedRowIndex}
          resultLimitations={analysisLimitations(result)}
          topCandidateId={topCandidate?.id}
          onSelect={(c) => selectCandidate(c, "evidence")}
          onToggleShortlist={async (c) => {
            if (!scenario) return;
            if (isCandidateShortlisted(scenario, c)) {
              await unpinFromShortlist(c.id);
            } else {
              await pinToShortlist(c);
            }
          }}
          onUnpinShortlist={unpinFromShortlist}
          onUpdateShortlistNote={saveShortlistNote}
          onReject={async (c, reason) => {
            await act("record_decision", {
              scenarioId: scenario.id,
              type: "reject_candidate",
              subjectId: c.id,
              reason,
            });
            await refresh();
          }}
          onSensitivityBranch={async (name) => {
            await act("create_scenario_branch", { name });
            await refresh();
            showToast(`Created branch “${name}” — run analysis on this branch when ready.`);
          }}
          resultsFilter={resultsFilter}
          onResultsFilterChange={setResultsFilter}
          onReviewDecision={() => setTab("decision")}
        />
      ) : null}

      {tab === "results" && (
        <TabErrorBoundary tabName="Results">
          <ResultsDrawer
            layout="page"
            open
            panel={drawerPanel}
            onPanelChange={setDrawerPanel}
            onClose={() => setTab("workspace")}
            drawingActive={false}
            result={result}
            stale={Boolean(result?.stale)}
            selected={selectedCandidate}
            shortlist={shortlist}
            scenario={scenario}
            datasets={workspace.datasets}
            onInspectDataset={(datasetId) => openDatasetInspect(datasetId)}
            floodCoverageDetail={floodCoverageDetail}
            yieldGap={yieldGap}
            housingGoalLine={housingGoalLine}
            onStartExcludeDraw={() => {
              setTab("workspace");
              startDraw("exclude");
            }}
            onInspectFloodDataset={() => {
              const flood = workspace.datasets.find((d) => d.kind === "flood");
              if (flood) openDatasetInspect(flood.id);
            }}
            housingTarget={housingTarget}
            totalCapacity={totalCapacity}
            intent={scenario.objective.intent}
            resultsColumns={resultsColumns}
            accessHeadline={accessHeadline}
            selectionUpdated={selectionUpdated}
            onDismissUpdated={() => setSelectionUpdated(false)}
            focusedRowIndex={focusedRowIndex}
            setFocusedRowIndex={setFocusedRowIndex}
            resultLimitations={analysisLimitations(result)}
            topCandidateId={topCandidate?.id}
            onSelect={(c) => selectCandidate(c, "evidence")}
            onToggleShortlist={async (c) => {
              if (!scenario) return;
              if (isCandidateShortlisted(scenario, c)) {
                await unpinFromShortlist(c.id);
              } else {
                await pinToShortlist(c);
              }
            }}
            onUnpinShortlist={unpinFromShortlist}
            onUpdateShortlistNote={saveShortlistNote}
            onReject={async (c, reason) => {
              await act("record_decision", {
                scenarioId: scenario.id,
                type: "reject_candidate",
                subjectId: c.id,
                reason,
              });
              await refresh();
            }}
            onSensitivityBranch={async (name) => {
              await act("create_scenario_branch", { name });
              await refresh();
              showToast(`Created branch “${name}” — run analysis on this branch when ready.`);
            }}
            resultsFilter={resultsFilter}
            onResultsFilterChange={setResultsFilter}
            onReviewDecision={() => setTab("decision")}
          />
        </TabErrorBoundary>
      )}

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
          layerData={layerData}
          compareIds={compareIds}
          setCompareIds={setCompareIds}
          comparison={comparison}
          tableRows={compareTableRows}
          inputsDiff={compareInputsDiff}
          housingTargets={compareHousingTargets}
          metricsIdentical={compareMetricsIdentical}
          sortKey={compareSortKey}
          onSortKey={setCompareSortKey}
          insights={compareInsights}
          busy={compareBusy}
          error={compareError}
          hint={compareHint}
          onHint={setCompareHint}
          onRunAnalysis={async (scenarioId, scenarioName) => {
            await act("activate_scenario", { scenarioId });
            setTab("workspace");
            setCompareHint(`Run analysis on “${scenarioName}” to include it in comparison.`);
            showToast(`Now viewing “${scenarioName}” — run analysis when ready.`);
          }}
          onCompare={async () => {
            const ids = [...compareIds];
            if (ids.length < 2) return;
            setCompareBusy(true);
            setCompareError(null);
            try {
              const data = (await act("compare_scenarios", { scenarioIds: ids })) as CompareScenariosToolPayload;
              applyCompareFromPayload(ids, data);
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
      {tab === "decision" && scenario && (
        <TabErrorBoundary tabName="Decision">
          <DecisionView
          workspace={workspace}
          scenario={scenario}
          result={result}
          topCandidate={topCandidate}
          shortlist={shortlist}
          yieldGap={yieldGap}
          housingGoalLine={housingGoalLine}
          shortlistedFeatureIds={shortlistedFeatureIds}
          layerData={layerData}
          onSelectShortlist={(candidateId) => {
            const c = candidates.find((x) => x.id === candidateId);
            if (c) void selectCandidate(c, "evidence");
          }}
          onUnpinShortlist={unpinFromShortlist}
          onUpdateShortlistNote={saveShortlistNote}
          reason={decisionReason}
          setReason={(v) => {
            if (!scenario) return;
            setDecisionReasonByScenario((prev) => ({ ...prev, [scenario.id]: v }));
            setDecisionError(null);
          }}
          error={decisionError}
          confirmType={confirmDecision}
          onRequestConfirm={(type) => {
            if (type === "approve_scenario" || type === "reject_scenario") {
              const reasonError = validateDecisionReason(decisionReason);
              if (reasonError) {
                setDecisionError(reasonError);
                return;
              }
            }
            if (type === "request_changes") {
              const trimmed = decisionReason.trim();
              if (trimmed && trimmed.length < 10) {
                setDecisionError(
                  "Please describe what changes are needed (at least 10 characters)."
                );
                return;
              }
            }
            setDecisionError(null);
            setConfirmDecision(type);
          }}
          onCancelConfirm={() => setConfirmDecision(null)}
          onGoToWorkspace={() => {
            setTab("workspace");
            setDrawerOpen(false);
          }}
          onDecide={async (type) => {
            setDecisionError(null);
            try {
              await act("record_decision", {
                scenarioId: scenario.id,
                type,
                reason: decisionReason.trim() || undefined,
              });
              setConfirmDecision(null);
              showToast(`Decision recorded: ${formatDecisionType(type)}`);
            } catch (e) {
              setDecisionError(e instanceof Error ? e.message : String(e));
            }
          }}
          />
        </TabErrorBoundary>
      )}
      {tab === "activity" && (
        <ActivityView
          workspace={workspace}
          selected={activeActivity}
          onSelect={setActivityId}
        />
      )}
      {tab === "report" && scenario && (
        <TabErrorBoundary tabName="Report">
          <ReportView
          workspace={workspace}
          scenario={scenario}
          result={result}
          shortlist={shortlist}
          onSelectShortlist={(candidateId) => {
            const c = candidates.find((x) => x.id === candidateId);
            if (c) void selectCandidate(c, "evidence");
          }}
          onUnpinShortlist={unpinFromShortlist}
          onUpdateShortlistNote={saveShortlistNote}
          selectedReportId={reportId}
          onSelectReport={setReportId}
          onDownload={(message) => showToast(message)}
          onGenerate={async () => {
            const data = (await act("generate_report", {
              scenarioIds: [scenario.id],
              title: `${workspace.project.name} — ${scenario.name} Planning Report`,
            })) as { reportId?: string };
            if (data.reportId) setReportId(data.reportId);
            await refresh();
          }}
          generating={busy}
        />
        </TabErrorBoundary>
      )}
      {inspectDatasetId && workspace && (() => {
        const inspectDataset = workspace.datasets.find((d) => d.id === inspectDatasetId);
        if (!inspectDataset) return null;
        return (
        <DatasetInspectPanel
          dataset={inspectDataset}
          datasets={workspace.datasets}
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

function ShortlistPanel(props: {
  entries: ResolvedShortlistEntry[];
  onUnpin: (candidateId: string) => void | Promise<void>;
  onUpdateNote: (candidateId: string, note: string) => void | Promise<void>;
  onSelect?: (candidateId: string) => void;
  onReviewDecision?: () => void;
  compact?: boolean;
}) {
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  if (props.entries.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        Pin sites from Results to build a package for decision.
      </p>
    );
  }

  return (
    <section className={props.compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-data-label uppercase">
          Candidate shortlist ({props.entries.length})
        </h4>
        {props.onReviewDecision && (
          <button
            type="button"
            onClick={props.onReviewDecision}
            className="text-caption text-primary-container hover:underline font-medium"
          >
            Review in Decision →
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {props.entries.map((entry) => {
          const id = entry.candidateId ?? entry.featureIds[0] ?? entry.label;
          const draft = noteDrafts[id] ?? entry.note ?? "";
          return (
            <li key={id} className="border border-outline-variant rounded p-3 text-body-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    <ProvenanceChip kind="planner_decision" />
                    {props.onSelect && entry.candidateId ? (
                      <button
                        type="button"
                        className="text-left hover:text-primary underline-offset-2 hover:underline"
                        onClick={() => props.onSelect!(entry.candidateId!)}
                      >
                        {entry.label}
                      </button>
                    ) : (
                      <span>{entry.label}</span>
                    )}
                    {entry.candidate && (
                      <span className="font-mono text-caption text-on-surface-variant">
                        Rank {entry.candidate.rank} · {formatCandidateScore(entry.candidate)}
                      </span>
                    )}
                    {entry.missing && (
                      <span className="text-caption text-secondary">Not in current results</span>
                    )}
                  </div>
                  <p className="text-caption text-on-surface-variant mt-1">
                    Why pinned: {shortlistPinReason(entry)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${entry.label} from shortlist`}
                  onClick={() => void props.onUnpin(id)}
                  className="shrink-0 px-2 py-1 hover:bg-surface-variant rounded text-on-surface-variant text-caption font-medium inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">keep_off</span>
                  Unpin
                </button>
              </div>
              <label className="block mt-2">
                <span className="font-mono text-[10px] uppercase text-on-surface-variant">
                  Note
                </span>
                <input
                  type="text"
                  value={draft}
                  maxLength={120}
                  placeholder="Optional one-line note"
                  onChange={(e) =>
                    setNoteDrafts((prev) => ({ ...prev, [id]: e.target.value }))
                  }
                  onBlur={() => {
                    const next = (noteDrafts[id] ?? draft).trim();
                    if (next !== (entry.note ?? "")) {
                      void props.onUpdateNote(id, next);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="mt-1 w-full border border-outline-variant rounded px-2 py-1 text-body-sm"
                />
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function YieldGapBanner({ gap }: { gap: YieldGapSummary }) {
  const tone = gap.needsWarning
    ? "border-secondary/40 bg-secondary-fixed/10 text-on-surface"
    : "border-outline-variant bg-surface-container-low text-on-surface-variant";
  return (
    <div role="status" className={`mb-3 border text-body-sm px-3 py-2 rounded ${tone}`}>
      <p className="font-medium text-on-surface mb-0.5">
        {gap.needsWarning ? "Housing yield gap" : "Housing yield"} — {gap.headline}
      </p>
      <p className="text-caption leading-relaxed">{gap.detail}</p>
    </div>
  );
}

function FloodCoverageAlert(props: {
  detail: FloodCoverageDetail;
  expanded: boolean;
  onToggle: () => void;
  onInspectEvidence?: () => void;
}) {
  const { detail, expanded, onToggle, onInspectEvidence } = props;
  return (
    <div
      role="note"
      className="mb-3 border border-outline-variant bg-surface-container-low text-on-surface-variant text-caption rounded overflow-hidden"
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-surface-container focus-ring"
        aria-expanded={expanded}
      >
        <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">
          {expanded ? "expand_less" : "expand_more"}
        </span>
        <span>{detail.summary}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-outline-variant">
          <p>
            <strong>Coverage:</strong> {detail.incompleteReason}
          </p>
          {detail.exclusionReasons.length > 0 && (
            <div>
              <strong>Exclusion reasons:</strong>
              <ul className="list-disc ml-5 mt-1 space-y-1">
                {detail.exclusionReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {detail.excludedParcelSamples.length > 0 && (
            <div>
              <strong>Sample excluded parcels:</strong>
              <ul className="list-disc ml-5 mt-1 space-y-1">
                {detail.excludedParcelSamples.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
          )}
          {onInspectEvidence && (
            <button
              type="button"
              onClick={onInspectEvidence}
              className="text-primary underline font-medium"
            >
              Open flood layer in Evidence
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ResultsFilterBar(props: {
  filter: ResultsFilterState;
  onChange: (next: ResultsFilterState) => void;
  neighborhoods: string[];
  totalCount: number;
  filteredCount: number;
  housingTarget?: number;
}) {
  const { filter, onChange, neighborhoods, totalCount, filteredCount, housingTarget } = props;
  const fieldClass =
    "w-full border border-outline-variant rounded px-2.5 py-1.5 text-body-sm bg-surface focus-ring";
  return (
    <div className="border border-outline-variant rounded-md p-3 bg-surface-container-low space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body-sm font-medium text-on-surface">Filter candidates</span>
        <span className="font-mono text-[11px] text-on-surface-variant">
          {filteredCount.toLocaleString()} of {totalCount.toLocaleString()}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-caption text-on-surface-variant block mb-1">Search</span>
          <input
            type="search"
            value={filter.text}
            onChange={(e) => onChange({ ...filter, text: e.target.value })}
            placeholder="Address or block-lot…"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="text-caption text-on-surface-variant block mb-1">Neighborhood</span>
          <select
            value={filter.neighborhood}
            onChange={(e) => onChange({ ...filter, neighborhood: e.target.value })}
            className={fieldClass}
          >
            <option value="">All neighborhoods</option>
            {neighborhoods.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-caption text-on-surface-variant block mb-1">Score</span>
          <select
            value={filter.scoreBand}
            onChange={(e) =>
              onChange({
                ...filter,
                scoreBand: e.target.value as ResultsFilterState["scoreBand"],
              })
            }
            className={fieldClass}
          >
            <option value="all">All scores</option>
            <option value="high">High (≥70)</option>
            <option value="medium">Medium (40–69)</option>
            <option value="low">Low (&lt;40)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-caption text-on-surface-variant block mb-1">Flood risk</span>
          <select
            value={filter.floodRisk}
            onChange={(e) =>
              onChange({
                ...filter,
                floodRisk: e.target.value as ResultsFilterState["floodRisk"],
              })
            }
            className={fieldClass}
          >
            <option value="all">All flood risk</option>
            <option value="high">High flood risk</option>
            <option value="moderate">Moderate flood risk</option>
            <option value="low">Low flood risk</option>
          </select>
        </label>
        <label className="block">
          <span className="text-caption text-on-surface-variant block mb-1">Min homes</span>
          <input
            type="text"
            inputMode="numeric"
            value={filter.capacityMin}
            onChange={(e) => onChange({ ...filter, capacityMin: e.target.value })}
            placeholder="Min"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="text-caption text-on-surface-variant block mb-1">Max homes</span>
          <input
            type="text"
            inputMode="numeric"
            value={filter.capacityMax}
            onChange={(e) => onChange({ ...filter, capacityMax: e.target.value })}
            placeholder="Max"
            className={fieldClass}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-body-sm">
        <input
          type="checkbox"
          checked={filter.shortlistedOnly}
          onChange={(e) => onChange({ ...filter, shortlistedOnly: e.target.checked })}
        />
        Shortlisted only
      </label>
      {housingTarget != null && housingTarget > 0 && (
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={filter.belowTargetOnly}
            onChange={(e) => onChange({ ...filter, belowTargetOnly: e.target.checked })}
          />
          Below {housingTarget.toLocaleString()}-home target only
        </label>
      )}
    </div>
  );
}

function ResultsDrawer(props: {
  layout?: "drawer" | "page";
  open: boolean;
  panel: DrawerPanel;
  onPanelChange: (panel: DrawerPanel) => void;
  onClose: () => void;
  drawingActive?: boolean;
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  stale: boolean;
  selected: Candidate | null;
  shortlist: ResolvedShortlistEntry[];
  scenario: WorkspaceSnapshot["scenarios"][0];
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
  floodCoverageDetail?: FloodCoverageDetail | null;
  yieldGap?: YieldGapSummary | null;
  housingGoalLine?: string | null;
  onStartExcludeDraw?: () => void;
  onInspectFloodDataset?: () => void;
  onSelect: (c: Candidate) => void;
  onToggleShortlist: (c: Candidate) => void | Promise<void>;
  onUnpinShortlist: (candidateId: string) => void | Promise<void>;
  onUpdateShortlistNote: (candidateId: string, note: string) => void | Promise<void>;
  onReject: (c: Candidate, reason: string) => Promise<void>;
  onSensitivityBranch?: (branchName: string) => void | Promise<void>;
  onReviewDecision?: () => void;
  resultsFilter: ResultsFilterState;
  onResultsFilterChange: (next: ResultsFilterState) => void;
}) {
  const { result, selected, panel, intent, scenario, shortlist } = props;
  const [floodExpanded, setFloodExpanded] = useState(false);
  const [evidenceTab, setEvidenceTab] = useState<"why" | "evidence" | "sensitivity">("why");
  const allCandidates = result?.candidates ?? [];
  const shortlistedIds = useMemo(
    () => new Set(shortlist.map((e) => e.candidateId).filter(Boolean) as string[]),
    [shortlist]
  );
  const filteredCandidates = useMemo(
    () =>
      filterCandidates(allCandidates, props.resultsFilter, shortlistedIds, {
        housingTarget: props.housingTarget,
      }),
    [allCandidates, props.resultsFilter, shortlistedIds, props.housingTarget]
  );
  const visibleCandidates = filteredCandidates;
  const neighborhoods = useMemo(() => candidateNeighborhoods(allCandidates), [allCandidates]);
  const floodDataset = props.datasets.find((d) => d.kind === "flood");
  const layout = props.layout ?? "drawer";
  const isPage = layout === "page";

  if (!isPage && !props.open) return null;

  const showEvidence = panel === "evidence" || Boolean(selected);
  const housingAnalysis = isHousingIntent(intent);
  const evidenceMetrics = selected
    ? evidenceMetricsForCandidate(selected, intent)
    : [];
  const limitationText = limitationsSummary(
    props.resultLimitations.length > 0
      ? props.resultLimitations
      : selected
        ? candidateProvenance(selected, props.resultLimitations).limitations
        : [],
    { fallback: "None noted" }
  );

  return (
    <div
      className={
        isPage
          ? "flex-1 min-h-0 flex flex-col overflow-hidden bg-surface"
          : `absolute bottom-7 left-[min(360px,28vw)] right-[min(320px,26vw)] max-h-[min(48vh,520px)] z-[1010] ${
              props.drawingActive ? "pointer-events-none" : "pointer-events-none"
            }`
      }
    >
      <div
        className={
          isPage
            ? "flex-1 min-h-0 flex flex-col overflow-hidden bg-surface border-t border-outline-variant"
            : `max-h-[min(48vh,520px)] bg-surface border-t border-outline-variant flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.06)] ${
                props.drawingActive ? "pointer-events-none" : "pointer-events-auto"
              }`
        }
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant bg-surface-container-low shrink-0">
          <div className="flex gap-4 items-center min-w-0">
            {isPage && (
              <h2 className="text-headline-md text-on-surface shrink-0">Results</h2>
            )}
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
                {props.yieldGap
                  ? props.yieldGap.headline
                  : props.totalCapacity >= props.housingTarget
                    ? `Eligible ${props.totalCapacity.toLocaleString()} vs ${props.housingTarget.toLocaleString()} target`
                    : `Shortfall of ${(props.housingTarget - props.totalCapacity).toLocaleString()} homes`}
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
            {shortlist.length > 0 && (
              <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded border border-[#815504] text-[#815504] whitespace-nowrap">
                Shortlist: {shortlist.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="p-1 hover:bg-surface-variant rounded"
            aria-label={isPage ? "Back to workspace map" : "Close results panel"}
          >
            <span className="material-symbols-outlined">{isPage ? "map" : "close"}</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden grid md:grid-cols-2 gap-px bg-outline-variant">
          <div
            className={`bg-surface p-4 overflow-auto min-h-0 ${panel === "evidence" ? "hidden md:block" : ""}`}
          >
            {props.floodCoverageDetail && (
              <FloodCoverageAlert
                detail={props.floodCoverageDetail}
                expanded={floodExpanded}
                onToggle={() => setFloodExpanded((v) => !v)}
                onInspectEvidence={props.onInspectFloodDataset}
              />
            )}
            {props.yieldGap && <YieldGapBanner gap={props.yieldGap} />}
            {props.housingGoalLine && !props.yieldGap && (
              <p className="text-body-sm text-on-surface-variant mb-3">{props.housingGoalLine}</p>
            )}
            {!result ? (
              <p className="text-body-sm text-on-surface-variant">
                Run analysis to populate ranked candidates here.
              </p>
            ) : result.status === "failed" ? (
              <p className="text-body-sm text-error">{result.error}</p>
            ) : result.candidates.length === 0 ? (
              <div>
                <p className="text-body-sm font-medium mb-2">No feasible candidates found.</p>
                <p className="text-caption text-on-surface-variant">{result.summary}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <ShortlistPanel
                  entries={shortlist}
                  compact
                  onUnpin={props.onUnpinShortlist}
                  onUpdateNote={props.onUpdateShortlistNote}
                  onReviewDecision={props.onReviewDecision}
                  onSelect={(candidateId) => {
                    const c = result?.candidates.find((x) => x.id === candidateId);
                    if (c) props.onSelect(c);
                  }}
                />
                <ResultsFilterBar
                  filter={props.resultsFilter}
                  onChange={props.onResultsFilterChange}
                  neighborhoods={neighborhoods}
                  totalCount={allCandidates.length}
                  filteredCount={filteredCandidates.length}
                  housingTarget={props.housingTarget}
                />
                {filteredCandidates.length === 0 && (
                  <p className="text-body-sm text-on-surface-variant">
                    No candidates match the current filters.
                  </p>
                )}
                <div className={`overflow-x-auto overflow-y-auto ${isPage ? "max-h-none flex-1 min-h-[12rem]" : "max-h-[min(36vh,320px)]"}`}>
                <table className="w-full text-left text-body-sm min-w-[520px]">
                  <thead className="sticky top-0 bg-surface z-10">
                    <tr className="font-mono text-data-label text-on-surface-variant border-b border-outline-variant">
                      <th className="py-2 pr-3 w-20 text-left" scope="col">
                        Pin
                      </th>
                      {props.resultsColumns.map((col) => (
                        <th key={col.key} className="py-2 pr-3 text-left" scope="col">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCandidates.map((c, rowIndex) => {
                      const pinned = isCandidateShortlisted(scenario, c);
                      return (
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
                        } ${pinned ? "bg-[#815504]/5" : ""} ${props.stale ? "opacity-60" : ""}`}
                      >
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            aria-label={pinned ? `Unpin ${c.label}` : `Pin ${c.label} to shortlist`}
                            title={pinned ? "Remove from shortlist" : "Pin to shortlist"}
                            disabled={c.status === "rejected"}
                            onClick={(e) => {
                              e.stopPropagation();
                              void props.onToggleShortlist(c);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-variant disabled:opacity-30 text-caption font-medium"
                          >
                            <span
                              className={`material-symbols-outlined text-[16px] ${
                                pinned ? "text-[#815504]" : "text-on-surface-variant"
                              }`}
                              style={{ fontVariationSettings: pinned ? "'FILL' 1" : "'FILL' 0" }}
                            >
                              keep
                            </span>
                            {pinned ? "Unpin" : "Pin"}
                          </button>
                        </td>
                        {props.resultsColumns.map((col) => (
                          <td key={col.key} className="py-2 pr-2 font-mono">
                            {col.format(c)}
                          </td>
                        ))}
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            )}
            {result && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {analysisAggregateMetrics(result)
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
                {(() => {
                  const provenance = candidateProvenance(selected, props.resultLimitations);
                  const floodCaveat = candidateFloodIncompleteCaveat(floodDataset, selected);
                  const confidencePct = Math.min(100, Math.max(12, selected.score));
                  return (
                    <>
                <div className="relative border border-outline-variant rounded overflow-hidden">
                  <div className="h-1 bg-surface-variant w-full">
                    <div
                      className="h-full bg-primary-container"
                      style={{ width: `${confidencePct}%` }}
                      role="presentation"
                      aria-label={`Confidence evidence ${confidencePct}%`}
                    />
                  </div>
                  <div className="p-3 bg-surface-container-lowest">
                    <h3 className="text-headline-md mb-1">{selected.label}</h3>
                    <div className="flex gap-2 items-center flex-wrap">
                      {props.topCandidateId === selected.id && (
                        <ProvenanceChip kind="copilot_recommendation" />
                      )}
                      <span className="font-mono text-data-label">
                        Score {formatCandidateScore(selected)} · rank {selected.rank}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 border-b border-outline-variant">
                  {(["why", "evidence", "sensitivity"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEvidenceTab(tab)}
                      className={`font-mono text-data-label pb-2 uppercase tracking-wide ${
                        evidenceTab === tab
                          ? "text-primary-container border-b-2 border-primary-container"
                          : "text-on-surface-variant hover:text-primary"
                      }`}
                    >
                      {tab === "why" ? "Why this candidate" : tab === "evidence" ? "Evidence" : "Sensitivity"}
                    </button>
                  ))}
                </div>
                {floodCaveat && (
                  <p className="text-caption text-secondary border border-secondary/40 bg-secondary-fixed/15 rounded px-2 py-1.5">
                    {floodCaveat}
                  </p>
                )}
                {evidenceTab === "why" && (
                  <div className="space-y-3 text-body-sm">
                    <p className="text-on-surface-variant leading-relaxed">
                      {selected.recommendationNote ??
                        "Ranked by weighted criteria under the active scenario constraints."}
                    </p>
                    {props.housingTarget != null && housingAnalysis && (
                      <p className="text-caption text-on-surface-variant">
                        Capacity {candidateMetricValue(selected, "capacity") ?? "—"} vs goal{" "}
                        {props.housingTarget.toLocaleString()} homes
                      </p>
                    )}
                    <ul className="text-caption space-y-1 border-t border-outline-variant pt-3">
                      {Object.entries(provenance.scoreBreakdown).slice(0, 5).map(([k, v]) => (
                        <li key={k} className="flex justify-between gap-2">
                          <span className="text-on-surface-variant">{k.replace(/_/g, " ")}</span>
                          <span className="font-mono">{v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {evidenceTab === "evidence" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {evidenceMetrics.map((m) => (
                        <div key={m.key} className="border border-outline-variant p-2 rounded">
                          <div className="font-mono text-[10px] uppercase text-on-surface-variant">
                            {m.label}
                          </div>
                          <div className="font-mono text-body-sm mt-1">
                            {m.value}
                            {m.unit ? ` ${m.unit}` : ""}
                          </div>
                          <ProvenanceChip kind={m.kind} />
                        </div>
                      ))}
                    </div>
                    <div>
                      <h4 className="font-mono text-data-label uppercase mb-2">Provenance</h4>
                      <ul className="text-caption space-y-1 text-on-surface-variant">
                        <li className="flex flex-wrap items-center gap-1">
                          <span>Datasets:</span>
                          {provenance.datasets.length > 0
                            ? provenance.datasets.map((id) => (
                                <DatasetRefChip
                                  key={id}
                                  label={id}
                                  datasets={props.datasets}
                                  onInspect={props.onInspectDataset}
                                />
                              ))
                            : "—"}
                        </li>
                        <li>Assumptions: {provenance.assumptions.join(", ") || "—"}</li>
                        <li>Constraints: {provenance.constraints.join("; ") || "—"}</li>
                        <li>Limitations: {limitationText}</li>
                      </ul>
                    </div>
                  </div>
                )}
                {evidenceTab === "sensitivity" && (
                  <div className="space-y-3">
                    <p className="text-body-sm text-on-surface-variant">
                      Branch the scenario to test how weight or constraint shifts change ranking for
                      this candidate.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {["Transit sensitivity", "Flood-weighted branch", "Capacity-first branch"].map(
                        (name) => (
                          <button
                            key={name}
                            type="button"
                            disabled={!props.onSensitivityBranch}
                            onClick={() => void props.onSensitivityBranch?.(name)}
                            className="text-caption border border-outline-variant px-3 py-1.5 rounded hover:border-primary-container text-on-surface disabled:opacity-40"
                          >
                            {name}
                          </button>
                        )
                      )}
                    </div>
                  </div>
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
                    </>
                  );
                })()}
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
                <DatasetProvenanceChips dataset={d} datasets={workspace.datasets} />
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

const COMPARE_COLUMN_TINTS = [
  "bg-[#f0eedb]/25",
  "bg-[#e8f4f8]/30",
  "bg-[#f6ebdd]/25",
  "bg-surface-container-low/50",
];

function bestCompareCellIndex(row: CompareTableRow): number | null {
  if (!row.applicable || row.cells.length < 2) return null;
  const nums = row.cells.map((c) => {
    const pct = c.match(/^(-?\d+)%$/);
    if (pct) return Number(pct[1]);
    const n = Number(c.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  });
  if (nums.some((n) => n == null)) return null;
  let best = 0;
  for (let i = 1; i < nums.length; i++) {
    if ((nums[i] ?? 0) > (nums[best] ?? 0)) best = i;
  }
  const allSame = nums.every((n) => n === nums[0]);
  return allSame ? null : best;
}

function CompareMetricsTable(props: {
  scenarioNames: string[];
  rows: CompareTableRow[];
  sortKey: "label" | "delta";
  onSortKey: (key: "label" | "delta") => void;
  showDelta?: boolean;
  sortable?: boolean;
  matrixStyle?: boolean;
}) {
  const sorted = [...props.rows].sort((a, b) => {
    if (props.sortKey === "delta") {
      return b.sortValue - a.sortValue || a.label.localeCompare(b.label);
    }
    return a.label.localeCompare(b.label);
  });

  const matrix = props.matrixStyle;

  return (
    <section
      className={
        matrix
          ? "border border-outline-variant rounded bg-surface overflow-hidden"
          : "overflow-auto border border-outline-variant bg-surface-container-lowest"
      }
    >
      {matrix && (
        <div className="bg-surface-container-low px-4 py-3 border-b border-outline-variant flex justify-between items-center">
          <h3 className="text-headline-md text-on-surface">Calculated comparison</h3>
          <span className="font-mono text-data-label text-outline uppercase text-[10px] tracking-wider">
            Data matrix
          </span>
        </div>
      )}
      {props.sortable !== false && (
        <div className="flex flex-wrap gap-2 p-3 border-b border-outline-variant text-caption">
          <span className="text-on-surface-variant">Sort rows by:</span>
          <button
            type="button"
            className={`px-2 py-0.5 rounded border ${
              props.sortKey === "label"
                ? "border-primary bg-primary-fixed/20 text-primary"
                : "border-outline-variant"
            }`}
            onClick={() => props.onSortKey("label")}
          >
            Metric name
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded border ${
              props.sortKey === "delta"
                ? "border-primary bg-primary-fixed/20 text-primary"
                : "border-outline-variant"
            }`}
            onClick={() => props.onSortKey("delta")}
          >
            Largest delta
          </button>
        </div>
      )}
      <div className={matrix ? "w-full overflow-x-auto" : ""}>
        <table className="w-full text-body-sm">
          <thead className="bg-surface-container-low font-mono text-data-label">
            <tr className={matrix ? "border-b border-outline-variant" : ""}>
              <th className="p-3 text-left text-on-surface-variant font-normal">Metric</th>
              {props.scenarioNames.map((name, i) => (
                <th
                  key={name}
                  className={`p-3 text-left text-on-surface-variant font-normal ${
                    matrix ? `border-l border-outline-variant ${COMPARE_COLUMN_TINTS[i % 4]}` : ""
                  }`}
                >
                  {name}
                </th>
              ))}
              {props.showDelta !== false && props.scenarioNames.length === 2 && (
                <th className="p-3 text-left text-on-surface-variant font-normal">Δ</th>
              )}
            </tr>
          </thead>
          <tbody className={matrix ? "font-mono text-data-label" : ""}>
            {sorted.map((row) => {
              const bestIdx = matrix ? bestCompareCellIndex(row) : null;
              return (
                <tr
                  key={row.key}
                  className={`border-t border-outline-variant ${
                    row.identical ? "" : "bg-surface-container-low/40"
                  } ${matrix ? "hover:bg-surface-container-lowest transition-colors" : ""}`}
                >
                  <td className={`p-3 ${matrix ? "text-on-surface font-sans" : "font-mono text-caption"}`}>
                    {row.label}
                  </td>
                  {row.cells.map((cell, i) => (
                    <td
                      key={`${row.key}-${i}`}
                      className={`p-3 font-mono ${
                        matrix
                          ? `border-l border-outline-variant ${COMPARE_COLUMN_TINTS[i % 4]} ${
                              bestIdx === i ? "font-bold" : ""
                            }`
                          : ""
                      }`}
                    >
                      {row.applicable ? (
                        cell
                      ) : (
                        <span className="text-caption text-on-surface-variant italic font-sans">
                          not in this analysis
                        </span>
                      )}
                    </td>
                  ))}
                  {props.showDelta !== false && props.scenarioNames.length === 2 && (
                    <td className="p-3 font-mono text-caption">
                      {row.applicable ? (row.delta ?? "—") : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompareView(props: {
  workspace: WorkspaceSnapshot;
  layerData: Record<string, GeoJSON.FeatureCollection>;
  compareIds: string[];
  setCompareIds: Dispatch<SetStateAction<string[]>>;
  comparison: Array<Record<string, string | number>> | null;
  tableRows: CompareTableRow[] | null;
  inputsDiff: ScenarioInputsDiff | null;
  housingTargets: Array<{
    scenarioId: string;
    name: string;
    progress: HousingTargetProgress | null;
  }> | null;
  metricsIdentical: boolean;
  sortKey: "label" | "delta";
  onSortKey: (key: "label" | "delta") => void;
  insights: Array<{ heading: string; body: string }> | null;
  busy?: boolean;
  error?: string | null;
  hint?: string | null;
  onHint: (msg: string | null) => void;
  onRunAnalysis: (scenarioId: string, scenarioName: string) => Promise<void>;
  onCompare: () => Promise<void>;
  onPrefer: (id: string) => Promise<void>;
}) {
  const { workspace } = props;

  function scenarioIsComparable(scenarioId: string): boolean {
    const scenario = workspace.scenarios.find((s) => s.id === scenarioId);
    return scenario
      ? scenarioHasComparableAnalysis(scenario, workspace.analysisResults)
      : false;
  }

  const selectedUnanalyzed = props.compareIds
    .map((id) => workspace.scenarios.find((s) => s.id === id))
    .filter((scenario): scenario is WorkspaceSnapshot["scenarios"][0] => Boolean(scenario))
    .filter((scenario) => !scenarioHasComparableAnalysis(scenario, workspace.analysisResults));

  const comparableSelectedCount = props.compareIds.filter((id) =>
    scenarioIsComparable(id)
  ).length;
  const scenarioNames =
    props.comparison?.map((row) => String(row.name)) ??
    props.compareIds
      .map((id) => workspace.scenarios.find((s) => s.id === id)?.name)
      .filter((n): n is string => Boolean(n));

  function toggleScenario(id: string) {
    const scenario = workspace.scenarios.find((s) => s.id === id);
    if (scenario && !scenarioHasComparableAnalysis(scenario, workspace.analysisResults)) {
      props.onHint(
        `“${scenario.name}” has no analysis results yet — run analysis on this branch before comparing.`
      );
      return;
    }
    props.setCompareIds((prev) => {
      const on = prev.includes(id);
      if (on) {
        if (prev.length <= 2) {
          props.onHint("Keep at least two analyzed scenarios selected to compare.");
          return prev;
        }
        props.onHint(null);
        return prev.filter((x) => x !== id);
      }
      props.onHint(null);
      return [...prev, id];
    });
  }

  const showResults =
    props.comparison &&
    props.comparison.length > 0 &&
    props.tableRows &&
    props.tableRows.length > 0;

  const compareMapEntries = props.compareIds
    .filter((id) => scenarioIsComparable(id))
    .map((id) => {
      const scenario = workspace.scenarios.find((s) => s.id === id);
      const result = workspace.analysisResults.find((r) => r.id === scenario?.latestResultId);
      return {
        scenarioId: id,
        name: scenario?.name ?? id,
        candidates: result?.candidates ?? [],
        stale: result?.stale,
      };
    });

  const copilotInterpretation =
    props.insights?.find((i) => i.heading === "Top recommendation")?.body ??
    props.insights?.[0]?.body ??
    null;

  const confidencePct = showResults
    ? Math.min(
        95,
        Math.max(
          55,
          70 + (props.insights?.filter((i) => !i.body.includes("identical")).length ?? 0) * 5
        )
      )
    : 0;

  return (
    <main className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-outline-variant bg-surface sticky top-0 z-20 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-display">Compare scenarios</h2>
          <p className="text-body-sm text-on-surface-variant mt-1">
            KPI matrix, synchronized maps, and copilot interpretation — not a lone table.
          </p>
        </div>
        <button
          type="button"
          disabled={comparableSelectedCount < 2 || props.busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void props.onCompare();
          }}
          className="bg-primary-container text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-40"
        >
          {props.busy
            ? "Comparing…"
            : `Compare selected (${comparableSelectedCount} analyzed)`}
        </button>
      </div>

      <div className="p-8 space-y-8 max-w-6xl">

      <div
        className="mb-6 border border-secondary/40 bg-secondary-fixed/10 px-4 py-3 rounded"
        role="note"
      >
        <p className="text-body-sm font-medium text-secondary mb-1">Rank score comparability</p>
        <p className="text-caption text-on-surface-variant">{RANK_SCORE_EXPLANATION}</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-2" role="group" aria-label="Scenarios to compare">
        {props.workspace.scenarios.map((s) => {
          const on = props.compareIds.includes(s.id);
          const hasResult = scenarioHasComparableAnalysis(s, workspace.analysisResults);
          return (
            <div key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={on}
                disabled={!hasResult}
                aria-label={`${on ? "Deselect" : "Select"} scenario ${s.name}`}
                onClick={() => toggleScenario(s.id)}
                className={`px-3 py-1.5 border text-body-sm transition-colors ${
                  on ? "border-primary bg-primary-fixed/30 text-primary" : "border-outline-variant"
                } ${!hasResult ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {s.name}
                {!hasResult && (
                  <span className="ml-1 text-caption text-on-surface-variant">(no analysis)</span>
                )}
                {on && <span className="ml-2 font-mono text-[10px]">selected</span>}
              </button>
              {!hasResult && (
                <button
                  type="button"
                  onClick={() => void props.onRunAnalysis(s.id, s.name)}
                  className="px-2 py-1.5 border border-primary text-primary text-caption rounded hover:bg-primary-fixed/20"
                >
                  Run analysis on {s.name}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {selectedUnanalyzed.length > 0 && (
        <div
          className="mb-4 border border-secondary/40 bg-secondary-fixed/10 px-4 py-3 rounded space-y-2"
          role="status"
        >
          <p className="text-body-sm text-secondary">
            These selected branches do not have completed analysis yet and cannot be compared:
          </p>
          <ul className="text-body-sm list-disc pl-5 space-y-1">
            {selectedUnanalyzed.map((scenario) => (
              <li key={scenario.id}>
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => void props.onRunAnalysis(scenario.id, scenario.name)}
                >
                  Run analysis on {scenario.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {props.hint && (
        <p className="text-caption text-secondary mb-3" role="status">
          {props.hint}
        </p>
      )}
      {props.compareIds.length < 2 && (
        <div
          className="mb-4 border border-dashed border-outline-variant rounded-lg p-6 text-center bg-surface-container-low"
          role="status"
        >
          <p className="text-body-sm text-on-surface mb-3">
            Compare needs at least two analyzed scenario branches.
          </p>
          {workspace.scenarios.filter((s) =>
            scenarioHasComparableAnalysis(s, workspace.analysisResults)
          ).length < 2 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {workspace.scenarios
                .filter((s) => !scenarioHasComparableAnalysis(s, workspace.analysisResults))
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void props.onRunAnalysis(s.id, s.name)}
                    className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm focus-ring"
                  >
                    Run analysis on {s.name}
                  </button>
                ))}
            </div>
          ) : (
            <p className="text-caption text-on-surface-variant">
              Select two or more analyzed scenarios above, then press Compare selected.
            </p>
          )}
        </div>
      )}
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

      {!props.busy && props.compareIds.length >= 2 && !showResults && !props.error && (
        <div
          className="mb-6 border border-dashed border-outline-variant rounded p-6 text-center bg-surface-container-low"
          role="status"
        >
          <p className="text-body-sm text-on-surface-variant">
            Press <strong>Compare selected</strong> to load metrics for the chosen scenarios.
          </p>
        </div>
      )}

      {props.inputsDiff && showResults && (
        <section className="mb-6 border border-outline-variant bg-surface-container-low p-4 space-y-4">
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant">
            Inputs — assumptions, weights &amp; constraints
          </h3>
          {props.inputsDiff.identicalMessage && (
            <p className="text-body-sm text-secondary border border-secondary/30 bg-secondary-fixed/10 px-3 py-2 rounded" role="status">
              {props.inputsDiff.identicalMessage}
            </p>
          )}
          {props.inputsDiff.sections.map((section) => (
            <div key={section.heading}>
              <h4 className="text-body-sm font-medium mb-1">
                {section.heading}
                {section.identical && (
                  <span className="ml-2 text-caption text-on-surface-variant">(match)</span>
                )}
              </h4>
              <ul className="text-body-sm text-on-surface-variant list-disc pl-5 space-y-0.5">
                {section.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {props.housingTargets?.some((h) => h.progress) && showResults && (
        <section className="mb-6 space-y-2">
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant">
            Housing target vs units
          </h3>
          {props.housingTargets
            .filter((h) => h.progress)
            .map((h) => (
              <p
                key={h.scenarioId}
                className="text-body-sm border border-primary-fixed/40 bg-primary-fixed/10 px-3 py-2 rounded"
              >
                <strong>{h.name}:</strong> {h.progress!.summary}
              </p>
            ))}
        </section>
      )}

      {showResults && props.metricsIdentical && props.inputsDiff?.allIdentical && (
        <div
          className="mb-4 border border-outline-variant bg-surface-container-low px-4 py-3 rounded"
          role="status"
        >
          <p className="text-body-sm text-on-surface-variant">
            Compared scenarios produced <strong>identical metrics</strong> because inputs are
            unchanged. Adjust weights or constraints on one branch, re-run analysis, then compare
            again.
          </p>
        </div>
      )}

      {showResults && compareMapEntries.length >= 2 && (
        <div className="mb-6">
          <CompareScenarioMaps
            workspace={workspace}
            layerData={props.layerData}
            entries={compareMapEntries}
          />
        </div>
      )}

      {showResults && props.tableRows && (
        <>
          <CompareMetricsTable
            scenarioNames={scenarioNames}
            rows={props.tableRows}
            sortKey={props.sortKey}
            onSortKey={props.onSortKey}
            sortable
            matrixStyle
          />

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-outline-variant pt-8">
            <div className="space-y-3">
              <h3 className="text-headline-md text-on-surface">Where the scenarios differ</h3>
              {props.insights && props.insights.length > 0 ? (
                <ul className="space-y-3 text-body-sm text-on-surface-variant">
                  {props.insights.map((item) => (
                    <li key={item.heading} className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-[18px] text-outline mt-0.5">
                        compare_arrows
                      </span>
                      <span>
                        <strong>{item.heading}:</strong> {item.body}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-sm text-on-surface-variant">
                  Run compare to load trade-off notes.
                </p>
              )}
            </div>

            <div className="border border-outline-variant rounded bg-surface p-5 flex flex-col gap-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 h-1 bg-surface-variant w-full">
                <div
                  className="h-full bg-primary-container transition-all"
                  style={{ width: `${confidencePct}%` }}
                  role="presentation"
                />
              </div>
              <div className="flex justify-between items-center mt-1 gap-2 flex-wrap">
                <h3 className="text-headline-md text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary-container">auto_awesome</span>
                  Copilot interpretation
                </h3>
                <span className="inline-flex items-center px-2 py-1 bg-primary-container text-on-primary rounded font-mono text-data-label text-[10px] uppercase tracking-wide">
                  AI recommendation
                </span>
              </div>
              <p className="text-body-sm text-on-surface-variant leading-relaxed">
                {copilotInterpretation ??
                  "Compare analyzed scenarios to surface a ranked recommendation and trade-off narrative."}
              </p>
            </div>
          </section>

          <div
            className="sticky bottom-0 bg-surface/95 backdrop-blur py-4 border-t border-outline-variant flex flex-wrap justify-between items-center gap-4 -mx-8 px-8 z-10"
          >
            <span className="text-headline-md text-on-surface">Select preferred scenario</span>
            <div className="flex flex-wrap gap-3">
              {props.comparison!.map((row, idx) => (
                <button
                  key={String(row.scenarioId)}
                  type="button"
                  onClick={() => props.onPrefer(String(row.scenarioId))}
                  className={`px-6 py-2 rounded font-mono text-data-label uppercase tracking-wide ${
                    idx === 0
                      ? "bg-tertiary text-on-tertiary hover:opacity-90"
                      : "border border-outline text-on-surface hover:bg-surface-container-low"
                  }`}
                >
                  Select {row.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      </div>
    </main>
  );
}

function EvidenceSummaryRow(props: { icon: string; label: string; text: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded bg-surface-container-highest flex items-center justify-center shrink-0 border border-outline-variant/50">
        <span className="material-symbols-outlined text-on-surface-variant text-sm">
          {props.icon}
        </span>
      </div>
      <div>
        <p className="font-mono text-data-label text-on-surface-variant mb-1 uppercase tracking-wide">
          {props.label}
        </p>
        <p className="text-body-sm text-on-surface">{props.text}</p>
      </div>
    </div>
  );
}

function buildDecisionTradeoffs(
  result: WorkspaceSnapshot["analysisResults"][0] | undefined,
  topCandidate: Candidate | null,
  yieldGap?: YieldGapSummary | null
): Array<{ tone: "positive" | "negative" | "warning"; text: string }> {
  const items: Array<{ tone: "positive" | "negative" | "warning"; text: string }> = [];
  if (yieldGap) {
    items.push({
      tone: yieldGap.needsWarning ? "negative" : "positive",
      text: yieldGap.headline,
    });
    if (yieldGap.detail) {
      items.push({ tone: "warning", text: yieldGap.detail });
    }
  }
  if (topCandidate && result) {
    const capacity = topCandidate.metrics.find((m) => m.key === "capacity")?.value;
    const maxCapacity = Math.max(
      ...result.candidates.map((c) => c.metrics.find((m) => m.key === "capacity")?.value ?? 0)
    );
    if (capacity != null && maxCapacity > capacity) {
      const pct = Math.round(((maxCapacity - capacity) / maxCapacity) * 100);
      items.push({
        tone: "negative",
        text: `Top recommendation is ${pct}% below maximum parcel capacity in this analysis.`,
      });
    }
    const transit = topCandidate.metrics.find((m) => m.key === "transit_distance_m")?.value;
    if (transit != null && transit >= 0 && transit <= 400) {
      items.push({
        tone: "positive",
        text: `Recommended site is within ${transit}m of transit — strong accessibility profile.`,
      });
    }
    if (topCandidate.recommendationNote) {
      items.push({ tone: "positive", text: topCandidate.recommendationNote });
    }
  }
  if (items.length === 0) {
    items.push({
      tone: "warning",
      text: "Run analysis and review evidence before recording a formal decision.",
    });
  }
  return items.slice(0, 4);
}

function DecisionView(props: {
  workspace: WorkspaceSnapshot;
  scenario: WorkspaceSnapshot["scenarios"][0];
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  topCandidate: Candidate | null;
  shortlist: ResolvedShortlistEntry[];
  yieldGap?: YieldGapSummary | null;
  housingGoalLine?: string | null;
  shortlistedFeatureIds: Set<string>;
  layerData: Record<string, GeoJSON.FeatureCollection>;
  onSelectShortlist: (candidateId: string) => void;
  onUnpinShortlist: (candidateId: string) => void | Promise<void>;
  onUpdateShortlistNote: (candidateId: string, note: string) => void | Promise<void>;
  reason: string;
  setReason: (v: string) => void;
  error: string | null;
  confirmType: "approve_scenario" | "reject_scenario" | "request_changes" | null;
  onRequestConfirm: (
    type: "approve_scenario" | "reject_scenario" | "request_changes"
  ) => void;
  onCancelConfirm: () => void;
  onGoToWorkspace: () => void;
  onDecide: (type: "approve_scenario" | "reject_scenario" | "request_changes") => Promise<void>;
}) {
  const { scenario, result, topCandidate } = props;
  const scenarioResults = props.workspace.analysisResults.filter(
    (item) => item.scenarioId === scenario.id
  );
  const evidenceBlocker = requireAnalysisForDecision(scenario, scenarioResults);
  const decisionEvidenceReady = evidenceBlocker === null;
  const hasFreshAnalysis = decisionEvidenceReady;
  const decisionLabel =
    scenario.decisionStatus === "approved" && scenario.decisionStale
      ? "Approved (stale)"
      : formatDecisionStatus(scenario.decisionStatus);
  const mapCandidates = result?.candidates ?? [];
  const readyForReview =
    decisionEvidenceReady &&
    scenario.decisionStatus !== "approved" &&
    scenario.decisionStatus !== "rejected";
  const tradeoffs = buildDecisionTradeoffs(result, topCandidate, props.yieldGap);
  const limitationItems = filterAnalysisCaveats(analysisLimitations(result), { max: 6 });
  const enabledDatasets = props.workspace.datasets
    .filter((d) => scenario.enabledDatasetIds.includes(d.id))
    .map((d) => d.name)
    .join(", ");

  const copilotLine = topCandidate
    ? `${scenario.name} centers on ${topCandidate.label} (score ${formatCandidateScore(topCandidate)}) under current weights and constraints.`
    : "No copilot recommendation until analysis completes.";

  return (
    <main className="flex-1 flex overflow-hidden min-h-0">
      <div className="flex-1 overflow-auto min-h-0">
        <div className="max-w-[1000px] mx-auto p-8 pb-24">
          <div className="mb-10 flex flex-wrap justify-between items-end gap-4 border-b border-outline-variant pb-6">
            <div>
              <p className="font-mono text-data-label text-on-surface-variant uppercase tracking-widest mb-2">
                Review decision
              </p>
              <h1 className="text-display text-primary">{scenario.name}</h1>
            </div>
            {readyForReview && (
              <span
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-primary-container text-primary-container font-mono text-data-label bg-primary-fixed/15"
                role="status"
              >
                <span className="w-2 h-2 rounded bg-primary-container shrink-0" />
                Ready for human review
              </span>
            )}
            {!readyForReview && hasFreshAnalysis && (
              <span className="font-mono text-data-label text-on-surface-variant uppercase">
                {decisionLabel}
              </span>
            )}
          </div>

          {!hasFreshAnalysis && (
            <div
              className="mb-8 border border-outline-variant rounded p-5 bg-surface-container-low space-y-3"
              role="status"
            >
              <p className="text-body-sm text-on-surface">
                {evidenceBlocker ??
                  (!result
                    ? "No analysis results for this scenario yet."
                    : "Evidence pack is incomplete for a formal decision.")}
              </p>
              <button
                type="button"
                className="bg-primary-container text-on-primary px-4 py-2 rounded text-body-sm focus-ring"
                onClick={props.onGoToWorkspace}
              >
                {result?.stale ? "Recalculate in Workspace" : "Run analysis in Workspace"}
              </button>
            </div>
          )}

          <div className="bg-surface-container-lowest border border-outline-variant rounded overflow-hidden mb-8 border-l-4 border-l-primary-container">
            <div className="h-1 bg-primary-container w-full" role="presentation" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4 text-primary-container">
                <span className="material-symbols-outlined">psychology</span>
                <span className="font-mono text-data-label uppercase tracking-widest">
                  Copilot recommendation
                </span>
                <ProvenanceChip kind="copilot_recommendation" />
              </div>
              <p className="text-body-lg text-on-surface max-w-3xl leading-relaxed">{copilotLine}</p>
            </div>
          </div>

          {result && isHousingIntent(scenario.objective.intent) && props.housingGoalLine && (
            <p className="text-body-sm text-on-surface-variant mb-6 border border-outline-variant bg-surface-container-low px-3 py-2 rounded">
              {props.housingGoalLine}
            </p>
          )}
          {props.yieldGap && <YieldGapBanner gap={props.yieldGap} />}

          <div className="grid grid-cols-12 gap-element-gap mb-8">
            <div className="col-span-12 lg:col-span-7 bg-surface-container-lowest border border-outline-variant rounded p-6">
              <div className="flex items-center gap-2 mb-6 border-b border-outline-variant pb-2">
                <h3 className="font-mono text-data-label text-on-surface-variant uppercase tracking-widest">
                  Evidence summary
                </h3>
                <ProvenanceChip kind="source_data" />
                <ProvenanceChip kind="calculated" />
              </div>
              <div className="space-y-4">
                <EvidenceSummaryRow
                  icon="flag"
                  label="Objective"
                  text={scenario.objective.rawText}
                />
                <EvidenceSummaryRow
                  icon="block"
                  label="Constraints"
                  text={
                    scenario.constraints
                      .filter((c) => c.enabled)
                      .map((c) => c.label)
                      .join("; ") || "None enabled"
                  }
                />
                <EvidenceSummaryRow
                  icon="database"
                  label="Datasets"
                  text={enabledDatasets || "None enabled for this scenario"}
                />
                <EvidenceSummaryRow
                  icon="analytics"
                  label="Results"
                  text={result?.summary ?? "No analysis yet"}
                />
              </div>
            </div>
            <div className="col-span-12 lg:col-span-5 bg-surface-container-lowest border border-outline-variant rounded p-6">
              <h3 className="font-mono text-data-label text-on-surface-variant uppercase tracking-widest mb-6 border-b border-outline-variant pb-2">
                Key trade-offs
              </h3>
              <ul className="space-y-4">
                {tradeoffs.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className={`material-symbols-outlined mt-0.5 ${
                        item.tone === "positive"
                          ? "text-primary-container"
                          : item.tone === "negative"
                            ? "text-error"
                            : "text-secondary"
                      }`}
                    >
                      {item.tone === "positive"
                        ? "add_circle"
                        : item.tone === "negative"
                          ? "remove_circle"
                          : "warning"}
                    </span>
                    <span className="text-body-sm text-on-surface">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <section className="mb-8 border border-secondary/30 bg-secondary-fixed/10 rounded p-5 flex items-start gap-4">
            <span className="material-symbols-outlined text-secondary mt-0.5">info</span>
            <div>
              <h4 className="font-mono text-data-label text-secondary uppercase tracking-widest mb-2">
                Uncertainty &amp; limitations
              </h4>
              <ul className="list-disc list-inside text-body-sm text-on-surface-variant space-y-1">
                {limitationItems.length > 0
                  ? limitationItems.map((l) => <li key={l}>{l}</li>)
                  : <li>No material limitations recorded for this analysis.</li>}
              </ul>
            </div>
          </section>

          <section className="mb-6">
            <ShortlistPanel
              entries={props.shortlist}
              onSelect={props.onSelectShortlist}
              onUnpin={props.onUnpinShortlist}
              onUpdateNote={props.onUpdateShortlistNote}
            />
          </section>

          <div className="border-t-2 border-primary-container pt-8 mb-10">
            <h2 className="text-headline-md text-primary-container mb-6 flex items-center gap-2">
              Your decision
              <ProvenanceChip kind="planner_decision" />
            </h2>
            <label className="block mb-6">
              <span className="font-mono text-data-label text-on-surface-variant uppercase tracking-wide">
                Reason for decision (required for approve or reject)
              </span>
              <textarea
                value={props.reason}
                onChange={(e) => props.setReason(e.target.value)}
                className={`mt-2 w-full border rounded p-3 text-body-sm focus-ring bg-surface-container-lowest ${
                  props.error ? "border-error" : "border-outline-variant focus:border-primary-container"
                }`}
                rows={3}
                placeholder="Enter justification or specific conditions…"
                disabled={!hasFreshAnalysis}
              />
              {props.error && (
                <p className="text-caption text-error mt-1" role="alert">{props.error}</p>
              )}
            </label>
            {hasFreshAnalysis ? (
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => props.onRequestConfirm("approve_scenario")}
                  className="flex-1 bg-secondary text-on-primary py-4 rounded text-headline-md hover:bg-secondary/90 flex items-center justify-center gap-2 focus-ring"
                >
                  <span className="material-symbols-outlined">check_circle</span>
                  Approve scenario
                </button>
                <button
                  type="button"
                  onClick={() => props.onRequestConfirm("request_changes")}
                  className="flex-1 bg-surface-container-highest border border-outline-variant text-on-surface py-4 rounded text-headline-md hover:bg-surface-variant flex items-center justify-center gap-2 focus-ring"
                >
                  <span className="material-symbols-outlined">edit_note</span>
                  Request changes
                </button>
                <button
                  type="button"
                  onClick={() => props.onRequestConfirm("reject_scenario")}
                  className="flex-1 border border-error text-error py-4 rounded text-headline-md hover:bg-error-container/30 flex items-center justify-center gap-2 focus-ring"
                >
                  <span className="material-symbols-outlined">cancel</span>
                  Reject
                </button>
              </div>
            ) : (
              <p className="text-caption text-on-surface-variant">
                Decision actions appear after analysis is complete and results are current.
              </p>
            )}
            <p className="mt-4 text-caption text-on-surface-variant">
              Current status:{" "}
              <span className="font-medium text-secondary">{decisionLabel}</span>
              {scenario.decisionStaleReason && (
                <span className="block mt-1 text-error">{scenario.decisionStaleReason}</span>
              )}
            </p>
          </div>

          <div className="max-h-[40vh] overflow-y-auto border-t border-outline-variant pt-6">
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
              {props.workspace.decisions.filter((d) => d.scenarioId === scenario.id).length === 0 && (
                <li className="text-body-sm text-on-surface-variant">No decisions recorded yet.</li>
              )}
            </ul>
          </div>

          {props.confirmType && (
            <div
              className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-decision-title"
            >
              <div className="bg-surface max-w-lg w-full rounded border border-outline-variant p-6">
                <h4 id="confirm-decision-title" className="text-headline-md mb-3">
                  Confirm {formatDecisionType(props.confirmType)}
                </h4>
                <p className="text-body-sm text-on-surface-variant mb-4">
                  You are about to record a planner decision on <strong>{scenario.name}</strong>.
                </p>
                <div className="text-body-sm space-y-2 mb-4 border border-outline-variant p-3 rounded bg-surface-container-low">
                  <p>
                    <strong>Copilot recommendation:</strong>{" "}
                    {topCandidate
                      ? `${topCandidate.label} (score ${formatCandidateScore(topCandidate)})`
                      : "—"}
                  </p>
                  <p>
                    <strong>Your reason:</strong> {props.reason.trim() || "(none entered)"}
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
                    className="bg-secondary text-on-primary px-4 py-2 rounded text-body-sm"
                  >
                    Confirm decision
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
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
            shortlistedFeatureIds={props.shortlistedFeatureIds}
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
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [scenarioFilter, setScenarioFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = props.workspace.activities.filter((a) => {
    if (!matchesActivityFilter(a, filter)) return false;
    if (scenarioFilter !== "all" && a.scenarioId !== scenarioFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const scenarioName =
        props.workspace.scenarios.find((s) => s.id === a.scenarioId)?.name ?? "";
      const blob = `${a.summary} ${a.action} ${scenarioName} ${activityCategoryLabel(a.category)}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  const scenarioName = props.selected?.scenarioId
    ? props.workspace.scenarios.find((s) => s.id === props.selected?.scenarioId)?.name
    : undefined;

  return (
    <main className="flex-1 min-h-0 overflow-hidden grid md:grid-cols-[1fr_360px]">
      <div className="overflow-y-auto p-6 min-h-0 flex flex-col">
        <div className="flex flex-wrap justify-between items-end gap-4 mb-6 border-b border-outline-variant pb-4 shrink-0">
          <div>
            <h2 className="text-display mb-2">Activity</h2>
            <p className="text-caption text-on-surface-variant">
              Provenance log for Urban Planning Copilot — agent, human, and system events.
            </p>
          </div>
          <button
            type="button"
            className="flex items-center gap-2 border border-outline-variant px-4 py-2 rounded text-body-sm hover:bg-surface-container transition-colors text-on-surface"
            onClick={() => {
              const lines = filtered.map(
                (a) =>
                  `${formatLocaleDateTime(a.timestamp)}\t${a.actor}\t${a.category}\t${a.summary}`
              );
              const blob = new Blob([lines.join("\n")], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "activity-export.txt";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export activity
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4 shrink-0">
          <div className="relative flex items-center flex-1 min-w-[200px]">
            <span
              className="material-symbols-outlined absolute left-2 text-outline text-[18px]"
              aria-hidden
            >
              search
            </span>
            <input
              type="search"
              placeholder="Search provenance log…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-full bg-surface-container border-b border-outline hover:border-primary focus:border-primary focus:outline-none transition-colors text-body-sm rounded-t"
            />
          </div>
          <div
            className="flex flex-wrap gap-2 font-mono text-data-label"
            role="group"
            aria-label="Activity filters"
          >
            {(Object.keys(ACTIVITY_FILTER_LABELS) as ActivityFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1 rounded border text-[11px] uppercase tracking-wide transition-colors ${
                  filter === key
                    ? "border-primary-container text-primary-container bg-primary-fixed/20"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {ACTIVITY_FILTER_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        {props.workspace.scenarios.length > 1 && (
          <label className="text-caption mb-4 shrink-0">
            Scenario{" "}
            <select
              value={scenarioFilter}
              onChange={(e) => setScenarioFilter(e.target.value)}
              className="ml-1 border border-outline-variant rounded px-2 py-1 text-body-sm"
            >
              <option value="all">All scenarios</option>
              {props.workspace.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex-1 relative">
          <div
            className="absolute left-[88px] top-2 bottom-2 w-px activity-thread-line z-0"
            aria-hidden
          />
          <ul className="space-y-6 relative z-10">
            {filtered.map((a) => {
              const accent = activityActorAccent(a.actor);
              const selected = props.selected?.id === a.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(a.id)}
                    className={`w-full text-left flex gap-6 group cursor-pointer ${
                      selected ? "ring-1 ring-primary-container/40 rounded" : ""
                    }`}
                  >
                    <div className="w-16 pt-1 text-right font-mono text-data-label text-on-surface-variant shrink-0">
                      {formatLocaleTime(a.timestamp)}
                    </div>
                    <div className="relative shrink-0 w-0">
                      <div
                        className={`w-6 h-6 rounded flex items-center justify-center absolute -left-3 top-0 border-4 border-surface-bright z-10 ${
                          a.actor === "human"
                            ? "bg-secondary text-on-secondary"
                            : a.actor === "agent"
                              ? "bg-primary-container text-on-primary"
                              : "bg-surface-variant text-on-surface border-outline-variant"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">{accent.icon}</span>
                      </div>
                    </div>
                    <div
                      className={`flex-1 bg-surface-container-lowest border border-outline-variant rounded p-4 group-hover:border-primary transition-colors shadow-sm relative ${
                        selected ? "border-primary" : ""
                      }`}
                    >
                      <div className={`absolute top-0 left-0 w-1 h-full rounded-l ${accent.bar}`} />
                      <div className="flex justify-between items-start gap-2 mb-1 pl-1">
                        <span
                          className={`font-mono text-data-label uppercase ${accent.badge}`}
                        >
                          {a.actor === "human"
                            ? "Human"
                            : a.actor === "agent"
                              ? "Agent"
                              : "System"}{" "}
                          · {activityCategoryLabel(a.category)}
                        </span>
                      </div>
                      <p className="text-body-lg text-on-surface pl-1">{a.summary}</p>
                      {a.scenarioId && (
                        <p className="text-caption text-on-surface-variant mt-2 pl-1">
                          {props.workspace.scenarios.find((s) => s.id === a.scenarioId)?.name ??
                            a.scenarioId}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="text-body-sm text-on-surface-variant pl-24">
                No events match these filters.
              </li>
            )}
          </ul>
        </div>
      </div>
      <aside className="border-l border-outline-variant p-6 overflow-y-auto bg-[#F0EEEB] min-h-0">
        <h3 className="text-headline-md mb-4">Event details</h3>
        {!props.selected ? (
          <p className="text-body-sm text-on-surface-variant">
            Select an event from the timeline to inspect provenance.
          </p>
        ) : (
          <div className="space-y-6 text-body-sm">
            <section>
              <div className="font-mono text-data-label uppercase text-outline mb-2 tracking-wider">
                What happened
              </div>
              <p className="text-body-lg font-medium">{props.selected.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="px-2 py-1 border border-outline rounded text-caption text-on-surface-variant">
                  {formatLocaleDateTime(props.selected.timestamp)}
                </span>
                {props.selected.actor === "agent" ? (
                  <span className="px-2 py-1 bg-primary-container text-on-primary rounded text-caption inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">smart_toy</span>
                    Copilot
                  </span>
                ) : props.selected.actor === "human" ? (
                  <ProvenanceChip kind="planner_decision" />
                ) : (
                  <span className="px-2 py-1 border border-outline-variant rounded text-caption">
                    System
                  </span>
                )}
              </div>
            </section>
            <div className="w-full h-px bg-outline-variant" />
            <section>
              <div className="font-mono text-data-label uppercase text-outline mb-2 tracking-wider">
                Action
              </div>
              <p className="font-mono text-caption">{props.selected.action}</p>
              <p className="text-caption text-on-surface-variant mt-1">
                {formatActivitySummary(props.selected)}
              </p>
            </section>
            {scenarioName && (
              <section>
                <div className="font-mono text-data-label uppercase text-outline mb-2 tracking-wider">
                  Scenario
                </div>
                <p>{scenarioName}</p>
              </section>
            )}
            <section>
              <div className="font-mono text-data-label uppercase text-outline mb-2 tracking-wider">
                Provenance tree
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-caption text-outline mb-1">Inputs</div>
                  <pre className="text-caption whitespace-pre-wrap bg-surface p-2 border border-outline-variant rounded">
                    {props.selected.inputs
                      ? JSON.stringify(props.selected.inputs, null, 2)
                      : "—"}
                  </pre>
                </div>
                <div className="flex justify-center text-outline" aria-hidden>
                  <span className="material-symbols-outlined">arrow_downward</span>
                </div>
                <div>
                  <div className="text-caption text-outline mb-1">Outputs / affected state</div>
                  <pre className="text-caption whitespace-pre-wrap bg-primary-fixed/10 p-2 border border-primary-fixed-dim rounded">
                    {props.selected.outputs &&
                    Object.keys(props.selected.outputs).length > 0
                      ? JSON.stringify(props.selected.outputs, null, 2)
                      : "—"}
                  </pre>
                </div>
              </div>
            </section>
            {props.selected.relatedDatasetIds?.length ? (
              <section>
                <div className="font-mono text-data-label uppercase text-outline mb-2 tracking-wider">
                  Datasets
                </div>
                <ul className="text-caption space-y-2">
                  {props.selected.relatedDatasetIds.map((id) => {
                    const ds = props.workspace.datasets.find((d) => d.id === id);
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 p-2 border border-outline-variant rounded bg-surface"
                      >
                        <span className="material-symbols-outlined text-outline text-[16px]">
                          dataset
                        </span>
                        <span>{ds?.name ?? id}</span>
                        <span className="ml-auto text-outline">v{ds?.version ?? "?"}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
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
  shortlist: ResolvedShortlistEntry[];
  onSelectShortlist: (candidateId: string) => void;
  onUnpinShortlist: (candidateId: string) => void | Promise<void>;
  onUpdateShortlistNote: (candidateId: string, note: string) => void | Promise<void>;
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
  const displayReportStaleReason = displayReport
    ? reportStaleLabel(displayReport, props.result)
    : null;
  const canGenerate = Boolean(props.result && !props.result.stale);
  const housingGoal =
    props.result && isHousingIntent(props.scenario.objective.intent)
      ? housingGoalSummary({
          target: resolveHousingTarget({
            intent: props.scenario.objective.intent,
            objectiveTarget: props.scenario.objective.targetValue,
            objectiveRawText: props.scenario.objective.rawText,
            projectName: props.workspace.project.name,
          }),
          totalCapacity: totalCapacityFromResult(props.result),
          targetGapMetric: analysisAggregateMetrics(props.result).find(
            (m) => m.key === "housing_target_gap"
          ),
          candidateCount: props.result.candidates.length,
          topSiteCapacity: topSiteCapacityFromResult(props.result),
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

  const [generateOpen, setGenerateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(Boolean(displayReport));

  return (
    <main className="flex-1 overflow-hidden flex flex-col min-h-0 relative">
      <div className="px-8 py-6 border-b border-outline-variant bg-surface flex flex-wrap justify-between items-center gap-4 shrink-0">
        <div>
          <h2 className="text-display flex items-center gap-3 flex-wrap">
            Reports
            <ProvenanceChip kind="calculated" />
          </h2>
          <p className="text-caption text-on-surface-variant mt-1">
            Manage and generate analytical planning documents for {props.scenario.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setGenerateOpen(true)}
          disabled={!canGenerate}
          className="bg-primary-container text-on-primary px-4 py-2 rounded text-body-sm flex items-center gap-2 disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Generate report
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8 bg-surface-container-lowest min-h-0">
        {!canGenerate && (
          <div className="mb-6 border border-outline-variant rounded p-5 bg-surface">
            <p className="text-body-sm text-on-surface mb-2">
              Run analysis on <strong>{props.scenario.name}</strong> before generating a report.
            </p>
          </div>
        )}
        {housingGoal && (
          <p className="text-body-sm text-on-surface-variant mb-6 border border-outline-variant bg-surface px-3 py-2 rounded">
            {housingGoal}
          </p>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
          {scenarioReports.map((r) => {
          const staleReason = reportStaleLabel(r, props.result);
          const isStale = Boolean(staleReason);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                props.onSelectReport(r.id);
                setPreviewOpen(true);
              }}
              className={`border border-outline-variant rounded bg-surface hover:border-outline transition-colors text-left flex flex-col relative overflow-hidden group ${
                displayReport?.id === r.id ? "ring-1 ring-primary-container" : ""
              }`}
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-surface-variant group-hover:bg-primary-container transition-colors" />
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-3 gap-2">
                  <span
                    className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border ${
                      isStale
                        ? "bg-error-container/30 text-error border-error/40"
                        : "bg-surface-container-high text-on-surface border-outline-variant"
                    }`}
                  >
                    {isStale ? "Stale" : "Ready"}
                  </span>
                  <ProvenanceChip kind="calculated" />
                </div>
                <h3 className="text-headline-md text-on-surface mb-2 leading-snug">{r.title}</h3>
                {isStale && staleReason && (
                  <p className="text-caption text-error mb-2">{staleReason}</p>
                )}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className="font-mono text-data-label text-outline mb-1 uppercase text-[10px]">
                      Project
                    </div>
                    <div className="text-body-sm truncate">{props.workspace.project.name}</div>
                  </div>
                  <div>
                    <div className="font-mono text-data-label text-outline mb-1 uppercase text-[10px]">
                      Scenario
                    </div>
                    <div className="text-body-sm truncate">{props.scenario.name}</div>
                  </div>
                </div>
              </div>
              <div className="px-5 py-3 border-t border-outline-variant bg-surface-container-low flex justify-between items-center">
                <span className="text-caption text-on-surface-variant flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                  {formatReportDateTime(r.createdAt)}
                </span>
                <span className="text-primary-container font-mono text-data-label text-[10px] uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                  Open preview
                </span>
              </div>
            </button>
          );
        })}
          {scenarioReports.length === 0 && (
            <div className="border border-dashed border-outline-variant rounded p-8 text-center bg-surface col-span-full">
              <p className="text-body-sm text-on-surface-variant mb-3">No reports yet for this scenario.</p>
              {canGenerate && (
                <button
                  type="button"
                  onClick={() => setGenerateOpen(true)}
                  className="text-body-sm text-primary-container hover:underline"
                >
                  Generate your first report
                </button>
              )}
            </div>
          )}
        </div>

        {otherReports.length > 0 && (
          <section className="mt-10 border-t border-outline-variant pt-6">
            <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-3">
              Other scenario reports
            </h3>
            <ul className="grid sm:grid-cols-2 gap-3">
              {otherReports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      props.onSelectReport(r.id);
                      setPreviewOpen(true);
                    }}
                    className="text-body-sm text-left w-full px-3 py-2 rounded border border-outline-variant hover:bg-surface bg-surface"
                  >
                    {r.title}
                    <span className="block text-caption text-on-surface-variant">
                      {formatReportDateTime(r.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {previewOpen && displayReport && (
        <div
          className="absolute inset-0 z-30 bg-black/30 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Report preview"
        >
          <div className="w-full max-w-2xl bg-surface h-full border-l border-outline-variant flex flex-col shadow-lg">
            <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-start gap-4 shrink-0">
              <div>
                <h3 className="text-headline-md">{displayReport.title}</h3>
                <p className="text-caption text-on-surface-variant mt-1">
                  {formatReportDateTime(displayReport.createdAt)} · {displayReport.audience}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  className="border border-outline-variant px-3 py-1.5 rounded text-caption"
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="p-1 hover:bg-surface-variant rounded"
                  aria-label="Close preview"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {displayReportStaleReason && (
                <p className="text-body-sm text-error border border-error/40 bg-error-container/20 px-3 py-2 rounded">
                  {displayReportStaleReason}
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                {displayReport.sections.map((s, i) => (
                  <div
                    key={i}
                    className={`border border-outline-variant rounded p-4 bg-surface-container-lowest ${
                      s.kind === "copilot_recommendation" ? "sm:col-span-2 border-t-2 border-t-primary-container" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-mono text-data-label uppercase text-on-surface-variant text-[10px]">
                        {s.heading}
                      </h4>
                      {s.kind === "source_data" ||
                      s.kind === "calculated" ||
                      s.kind === "copilot_recommendation" ||
                      s.kind === "planner_decision" ? (
                        <ProvenanceChip kind={s.kind} />
                      ) : null}
                    </div>
                    <p className="text-body-sm text-on-surface-variant whitespace-pre-wrap line-clamp-6">
                      {s.body}
                    </p>
                    {s.data != null && Array.isArray(s.data) && s.kind === "comparison" && (
                      <div className="mt-3 overflow-hidden rounded border border-outline-variant">
                        <CompareMetricsTable
                          scenarioNames={(s.data as Array<Record<string, string | number>>).map(
                            (row) => String(row.name)
                          )}
                          rows={buildCompareTableRows(
                            s.data as Array<Record<string, string | number>>
                          )}
                          sortKey="label"
                          onSortKey={() => undefined}
                          sortable={false}
                        />
                      </div>
                    )}
                    {s.data != null &&
                      Array.isArray(s.data) &&
                      s.kind === "calculated" &&
                      (s.data as Array<{ key?: string; label?: string; value?: number; unit?: string }>)[0]
                        ?.key != null && (
                        <ul className="mt-2 text-caption space-y-1">
                          {(
                            s.data as Array<{
                              key: string;
                              label: string;
                              value: number;
                              unit?: string;
                            }>
                          )
                            .slice(0, 6)
                            .map((m) => (
                              <li key={m.key} className="flex justify-between gap-2">
                                <span>{m.label}</span>
                                <span className="font-mono">
                                  {m.value.toLocaleString()}
                                  {m.unit ? ` ${m.unit}` : ""}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {generateOpen && (
        <div
          className="absolute inset-y-0 right-0 z-40 w-full max-w-md bg-surface border-l border-outline-variant shadow-lg flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Generate report"
        >
          <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center">
            <h3 className="text-headline-md">Generate report</h3>
            <button
              type="button"
              onClick={() => setGenerateOpen(false)}
              className="p-1 hover:bg-surface-variant rounded"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            <p className="text-body-sm text-on-surface-variant">
              Creates a structured planning brief for <strong>{props.scenario.name}</strong> with
              objective, methodology, ranked candidates, and decision history.
            </p>
            <div className="border border-outline-variant rounded p-4 bg-surface-container-low space-y-2 text-body-sm">
              <p>
                <span className="font-mono text-data-label text-[10px] uppercase text-on-surface-variant">
                  Includes
                </span>
              </p>
              <ul className="text-caption list-disc pl-5 space-y-1 text-on-surface-variant">
                <li>Objective and constraints snapshot</li>
                <li>Methodology and dataset provenance</li>
                <li>{props.result?.candidates.length ?? 0} ranked candidates</li>
                <li>Planner decision history</li>
              </ul>
            </div>
            <ShortlistPanel
              entries={props.shortlist}
              onSelect={props.onSelectShortlist}
              onUnpin={props.onUnpinShortlist}
              onUpdateNote={props.onUpdateShortlistNote}
            />
          </div>
          <div className="p-6 border-t border-outline-variant shrink-0">
            <button
              type="button"
              onClick={async () => {
                setLocalGenerating(true);
                try {
                  await props.onGenerate();
                  setGenerateOpen(false);
                  setPreviewOpen(true);
                } finally {
                  setLocalGenerating(false);
                }
              }}
              disabled={!canGenerate || generating}
              className="w-full bg-primary-container text-on-primary py-3 rounded text-body-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {generating && (
                <span className="material-symbols-outlined text-[18px] animate-spin">
                  progress_activity
                </span>
              )}
              {generating ? "Generating…" : scenarioReports.length > 0 ? "Update report" : "Generate report"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function WorkspaceLoadingSkeleton({
  phase,
  elapsedMs,
  isRetrying,
}: {
  phase: string;
  elapsedMs: number;
  isRetrying: boolean;
}) {
  const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden" aria-busy="true">
      <div className="h-14 border-b border-outline-variant bg-surface-container-high px-section-padding flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-5 w-40 bg-surface-variant rounded animate-pulse" />
          <div className="h-4 w-56 bg-surface-variant/70 rounded animate-pulse hidden sm:block" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 w-8 bg-surface-variant rounded animate-pulse" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-10 border-b border-outline-variant bg-surface-container-low px-4 flex items-center gap-3 shrink-0">
            <div className="h-4 w-24 bg-surface-variant rounded animate-pulse" />
            <div className="h-4 w-32 bg-surface-variant/70 rounded animate-pulse" />
            <div className="h-4 w-20 bg-surface-variant/70 rounded animate-pulse" />
          </div>
          <div className="flex-1 relative bg-surface-container-low">
            <div className="absolute inset-0 bg-gradient-to-br from-surface-container-low via-surface-container to-surface-container-high animate-pulse" />
            <div className="absolute bottom-6 left-6 h-24 w-36 border border-outline-variant/50 bg-surface/60 rounded animate-pulse" />
            <div className="absolute bottom-6 right-6 h-10 w-28 border border-outline-variant/50 bg-surface/60 rounded animate-pulse" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-body-sm text-on-surface-variant">
              <span className="material-symbols-outlined animate-spin text-primary text-[28px]">
                progress_activity
              </span>
              <p className="font-medium text-on-surface">Loading workspace…</p>
              <p className="text-caption max-w-sm text-center">{phase}</p>
              {elapsedMs > 0 && (
                <p className="text-caption text-outline">
                  {elapsedSec}s elapsed{isRetrying ? " — retrying" : ""}
                </p>
              )}
              {elapsedMs >= 12_000 && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-2 border border-outline-variant px-4 py-2 rounded text-caption"
                >
                  Retry load
                </button>
              )}
            </div>
          </div>
        </div>
        <aside className="hidden lg:flex w-inspector-width shrink-0 border-l border-outline-variant flex-col bg-surface-container-lowest">
          <div className="p-4 border-b border-outline-variant space-y-2">
            <div className="h-5 w-40 bg-surface-variant rounded animate-pulse" />
            <div className="h-3 w-full bg-surface-variant/70 rounded animate-pulse" />
          </div>
          <div className="p-4 space-y-3 flex-1">
            <div className="h-4 w-28 bg-surface-variant rounded animate-pulse" />
            <div className="h-16 w-full bg-surface-variant/60 rounded animate-pulse" />
            <div className="h-16 w-full bg-surface-variant/60 rounded animate-pulse" />
            <div className="h-4 w-24 bg-surface-variant rounded animate-pulse mt-4" />
            <div className="h-8 w-full bg-surface-variant/50 rounded animate-pulse" />
          </div>
          <div className="p-3 border-t border-outline-variant space-y-2">
            <div className="h-10 w-full bg-surface-variant/60 rounded animate-pulse" />
            <div className="h-9 w-24 bg-primary/30 rounded animate-pulse ml-auto" />
          </div>
        </aside>
      </div>
    </div>
  );
}
