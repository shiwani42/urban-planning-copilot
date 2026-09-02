"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ProvenanceChip, useWorkspace } from "@/components/workspace-hooks";
import { WebMcpProvider } from "@/components/WebMcpProvider";
import { formatLocaleTime } from "@/lib/format";
import type {
  Candidate,
  CriterionWeight,
  WorkspaceSnapshot,
} from "@/lib/domain/types";

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

export default function WorkspaceClient({ projectId }: { projectId: string }) {
  const { workspace, loading, error, busy, act, refresh } = useWorkspace(projectId);
  const [tab, setTab] = useState<Tab>("workspace");
  const [layerData, setLayerData] = useState<Record<string, GeoJSON.FeatureCollection>>({});
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPanel, setDrawerPanel] = useState<DrawerPanel>("candidates");
  const [drawingExclusion, setDrawingExclusion] = useState(false);
  const [excludeClicks, setExcludeClicks] = useState<[number, number][]>([]);
  const [weightDraft, setWeightDraft] = useState<CriterionWeight[] | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Array<Record<string, string | number>> | null>(
    null
  );
  const [report, setReport] = useState<WorkspaceSnapshot["reports"][0] | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const scenario = workspace?.scenarios.find(
    (s) => s.id === workspace.project.activeScenarioId
  );
  const result = workspace?.analysisResults.find((r) => r.id === scenario?.latestResultId);
  const candidates = result?.candidates ?? [];
  const runningJob = workspace?.analysisJobs.find(
    (j) => j.scenarioId === scenario?.id && j.status === "running"
  );

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
    if (!workspace) return;
    const id = workspace.project.mapState.selectedCandidateId;
    if (!id) {
      setSelectedCandidate(null);
      return;
    }
    const c = candidates.find((x) => x.id === id);
    setSelectedCandidate(c ?? null);
  }, [workspace?.project.mapState.selectedCandidateId, candidates]);

  useEffect(() => {
    if (scenario) setWeightDraft(scenario.weights);
  }, [scenario?.id, scenario?.updatedAt]);

  useEffect(() => {
    if (tab === "compare" && scenario && compareIds.length === 0) {
      setCompareIds([scenario.id]);
    }
  }, [tab, scenario?.id, compareIds.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const visibleLayerKinds = useMemo(() => {
    if (!workspace) return new Set<string>();
    const ids = new Set(
      workspace.project.mapState.layers.filter((l) => l.visible).map((l) => l.datasetId)
    );
    return new Set(
      workspace.datasets.filter((d) => ids.has(d.id)).map((d) => d.kind)
    );
  }, [workspace]);

  const selectCandidate = useCallback(
    async (c: Candidate, panel: DrawerPanel = "evidence") => {
      setSelectedCandidate(c);
      setDrawerOpen(true);
      setDrawerPanel(panel);
      setTab("results");
      await act("select_candidate", {
        candidateId: c.id,
        featureIds: c.featureIds,
      });
    },
    [act]
  );

  const weightSum = useMemo(() => {
    const draft = weightDraft ?? scenario?.weights ?? [];
    return Math.round(draft.reduce((sum, w) => sum + w.weight, 0) * 100);
  }, [weightDraft, scenario?.weights]);

  const housingTarget = scenario?.objective.targetValue;
  const totalCapacity = result?.aggregateMetrics.find((m) => m.key === "total_capacity")?.value;
  const targetGap = result?.aggregateMetrics.find((m) => m.key === "housing_target_gap");

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
    setTab("workspace");
    await act("run_analysis", { scenarioId: scenario.id });
    setDrawerOpen(true);
    setTab("results");
  }

  async function applyWeights() {
    if (!scenario || !weightDraft) return;
    await act("update_weights", { scenarioId: scenario.id, weights: weightDraft });
  }

  async function updateTransitThreshold(meters: number) {
    if (!scenario) return;
    const constraints = scenario.constraints.map((c) =>
      c.operator === "within_distance"
        ? { ...c, value: meters, label: `Within ${meters}m of transit` }
        : c
    );
    await act("update_constraints", { scenarioId: scenario.id, constraints });
  }

  async function finishExclusionPolygon() {
    if (!scenario || excludeClicks.length < 3) return;
    const ring = [...excludeClicks, excludeClicks[0]];
    await act("add_geo_selection", {
      scenarioId: scenario.id,
      selection: {
        type: "exclusion",
        label: `Human exclusion (${excludeClicks.length} pts)`,
        geometry: {
          type: "Polygon",
          coordinates: [ring.map(([lng, lat]) => [lng, lat])],
        },
        createdBy: "human",
      },
    });
    setExcludeClicks([]);
    setDrawingExclusion(false);
  }

  async function duplicateScenario(name: string) {
    if (!scenario) return;
    await act("create_scenario", { name, fromScenarioId: scenario.id });
  }

  async function saveScenario() {
    if (!scenario) return;
    await act("save_scenario", { scenarioId: scenario.id });
    setToast(`Scenario "${scenario.name}" saved`);
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-body-sm text-on-surface-variant">
        Loading workspace…
      </div>
    );
  }

  if (!workspace || !scenario) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-body-sm text-error">{error ?? "Workspace not found"}</p>
        <Link href="/" className="text-primary text-body-sm hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const activeActivity = workspace.activities.find((a) => a.id === activityId);

  return (
    <WebMcpProvider projectId={projectId}>
    <div className="h-screen flex flex-col overflow-hidden bg-background relative">
      {workspace.proposals.length > 0 && (
        <div className="bg-secondary-fixed/20 border-b border-secondary/30 px-section-padding py-3 shrink-0 z-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ProvenanceChip kind="planner_decision" />
                <span className="font-mono text-data-label uppercase text-secondary">
                  Human review required
                </span>
              </div>
              {workspace.proposals.map((prop) => (
                <div key={prop.id} className="text-body-sm">
                  <strong>{prop.title}</strong> — {prop.description}
                  <span className="font-mono text-caption text-on-surface-variant ml-2">
                    revision {prop.baseRevision.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
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
            className="p-2 hover:bg-surface-variant rounded"
            title="Save scenario"
          >
            <span className="material-symbols-outlined">save</span>
          </button>
        </div>
      </header>

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
          {scenario.objective.parsedRequirements.slice(0, 4).map((r) => (
            <span
              key={r}
              className="px-2 py-0.5 border border-outline rounded text-caption text-on-surface-variant whitespace-nowrap"
            >
              {r}
            </span>
          ))}
        </div>
        {result && housingTarget && totalCapacity != null && (
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
        {result?.stale && (
          <span className="shrink-0 px-3 py-1 rounded border border-secondary bg-secondary-fixed/20 text-secondary text-caption font-medium whitespace-nowrap">
            Results stale — recalculate
          </span>
        )}
        {workspace.project.resumeNote && !result?.stale && (
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
                          <label className="flex flex-col items-end gap-0.5 shrink-0">
                            <span className="sr-only">Transit proximity threshold in meters</span>
                            <span className="font-mono text-[10px] text-on-surface-variant uppercase">
                              Meters
                            </span>
                            <input
                              type="number"
                              aria-label="Transit proximity threshold in meters"
                              className="w-20 font-mono text-data-label bg-primary-fixed px-1.5 py-0.5 rounded text-primary"
                              value={Number(c.value)}
                              onChange={(e) => updateTransitThreshold(Number(e.target.value))}
                            />
                          </label>
                        )}
                      </div>
                    );})}
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
                    disabled={busy || weightSum !== 100}
                    title={weightSum !== 100 ? "Priorities must sum to 100% before applying" : undefined}
                  >
                    Apply priorities
                  </button>
                </div>
                {weightSum !== 100 && (
                  <p className="text-caption text-secondary mb-2" role="status">
                    Priorities sum to {weightSum}% — adjust to 100% before applying.
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
                        onChange={(e) => {
                          const next = [...(weightDraft ?? scenario.weights)];
                          next[i] = { ...next[i], weight: Number(e.target.value) / 100 };
                          setWeightDraft(next);
                        }}
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
                    const vis = workspace.project.mapState.layers.find(
                      (l) => l.datasetId === d.id
                    )?.visible;
                    return (
                      <label key={d.id} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(vis)}
                          onChange={async (e) => {
                            const layers = workspace.project.mapState.layers.map((l) =>
                              l.datasetId === d.id
                                ? { ...l, visible: e.target.checked }
                                : l
                            );
                            await act("update_map", { mapState: { layers } });
                          }}
                          className="rounded border-outline text-primary h-4 w-4"
                        />
                        <span className="text-body-sm">
                          {d.name.replace(" (Synthetic)", "").replace(" (Synthetic North River)", "")}
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
                  {workspace.scenarios.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => act("activate_scenario", { scenarioId: s.id })}
                      className={`w-full text-left px-2 py-1.5 text-body-sm rounded border ${
                        s.id === scenario.id
                          ? "border-primary bg-primary-fixed/30"
                          : "border-outline-variant hover:bg-surface-container"
                      }`}
                    >
                      {s.name}
                      <span className="text-caption text-on-surface-variant ml-2">
                        · {s.status}
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() =>
                      duplicateScenario(`Branch ${workspace.scenarios.length + 1}`)
                    }
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
              onSelectCandidate={(c) => selectCandidate(c, "evidence")}
              drawingExclusion={drawingExclusion}
              excludeClicks={excludeClicks}
              stale={Boolean(result?.stale)}
              onMapClickExclude={({ lat, lng }) => {
                setExcludeClicks((prev) => [...prev, [lng, lat]]);
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
                  setDrawingExclusion((v) => !v);
                  setExcludeClicks([]);
                }}
                className={`glass-panel p-2 rounded border border-outline-variant pointer-events-auto ${
                  drawingExclusion ? "bg-error-container" : ""
                }`}
                title="Draw exclusion polygon"
              >
                <span className="material-symbols-outlined">block</span>
              </button>
              {drawingExclusion && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void finishExclusionPolygon();
                  }}
                  disabled={excludeClicks.length < 3}
                  className="glass-panel px-2 py-1 rounded border border-outline-variant text-caption disabled:opacity-40 pointer-events-auto"
                >
                  Finish ({excludeClicks.length})
                </button>
              )}
            </div>

            <div className="absolute left-4 bottom-28 glass-panel p-3 rounded border border-outline-variant z-[1001] max-w-[240px] pointer-events-auto">
              <h4 className="font-mono text-data-label text-on-surface-variant uppercase mb-2">
                Legend
              </h4>
              <MapLegend visibleKinds={visibleLayerKinds} />
            </div>

            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-[1001] pointer-events-auto">
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

          <aside className="w-inspector-width bg-surface border-l border-outline-variant flex flex-col z-30 shrink-0 min-h-0">
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
                    {runningJob
                      ? runningJob.currentStep ?? "Analysis running…"
                      : result
                        ? "Analysis complete — review results"
                        : "Review the plan, then run analysis"}
                  </p>
                </div>
              </div>
              <span className="material-symbols-outlined text-outline">smart_toy</span>
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
                                <span
                                  key={d}
                                  className="px-1.5 py-0.5 bg-surface-container border border-outline-variant font-mono text-[10px]"
                                >
                                  {d}
                                </span>
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
                            {formatLocaleTime(a.timestamp)}
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
                  {result.candidates[0] && result.candidates[0].status !== "rejected" && (
                    <div className="bg-primary-container/10 border border-primary-fixed p-2 rounded">
                      <ProvenanceChip kind="copilot_recommendation" />
                      <p className="text-body-sm mt-2">
                        Top candidate: <strong>{result.candidates[0].label}</strong> (score{" "}
                        {result.candidates[0].score})
                      </p>
                      <p className="text-caption text-on-surface-variant mt-1">
                        Recommendation only — not a planning decision.
                      </p>
                    </div>
                  )}
                  {selectedCandidate && (
                    <button
                      onClick={() => setDrawerOpen(true)}
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
                <span>{scenario.analysisPlan?.datasets.length ?? 0} DATASETS</span>·
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
                {result ? "Recalculate" : "Run analysis"}
              </button>
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
          result={result}
          stale={Boolean(result?.stale)}
          selected={selectedCandidate}
          housingTarget={housingTarget}
          totalCapacity={totalCapacity}
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
        <EvidenceView workspace={workspace} scenarioId={scenario.id} />
      )}
      {tab === "compare" && (
        <CompareView
          workspace={workspace}
          compareIds={compareIds}
          setCompareIds={setCompareIds}
          comparison={comparison}
          busy={busy}
          onCompare={async () => {
            const ids = [...compareIds];
            if (ids.length < 2) return;
            const res = await fetch(`/api/projects/${projectId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "compare_scenarios", scenarioIds: ids }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Compare failed");
            setComparison(data.comparison ?? null);
            setCompareIds(ids);
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
          reason={decisionReason}
          setReason={(v) => {
            setDecisionReason(v);
            setDecisionError(null);
          }}
          error={decisionError}
          onDecide={async (type) => {
            if (
              (type === "approve_scenario" || type === "reject_scenario") &&
              !decisionReason.trim()
            ) {
              setDecisionError("Please enter a reason — required for the audit trail.");
              return;
            }
            setDecisionError(null);
            await act("record_decision", {
              scenarioId: scenario.id,
              type,
              reason: decisionReason.trim() || undefined,
            });
            setToast(`Decision recorded: ${type.replace(/_/g, " ")}`);
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
          report={report}
          onGenerate={async () => {
            const data = await act("generate_report", {
              scenarioIds: workspace.scenarios.map((s) => s.id),
              title: `${workspace.project.name} — Planning Report`,
            });
            setReport(data.report);
            await refresh();
          }}
        />
      )}
    </div>
    </WebMcpProvider>
  );
}

function ResultsDrawer(props: {
  open: boolean;
  panel: DrawerPanel;
  onPanelChange: (panel: DrawerPanel) => void;
  onClose: () => void;
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  stale: boolean;
  selected: Candidate | null;
  housingTarget?: number;
  totalCapacity?: number;
  onSelect: (c: Candidate) => void;
  onReject: (c: Candidate, reason: string) => Promise<void>;
}) {
  const { result, selected, panel } = props;
  if (!props.open) return null;

  const showEvidence = panel === "evidence" || Boolean(selected);

  return (
    <div className="absolute bottom-0 left-[300px] right-[360px] max-h-[42vh] z-[35] pointer-events-none">
      <div className="max-h-[42vh] bg-surface border-t border-outline-variant flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pointer-events-auto">
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
            {props.housingTarget != null && props.totalCapacity != null && (
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
            {props.stale && (
              <span className="text-caption text-secondary font-medium whitespace-nowrap">
                Stale — recalculate
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
                <table className="w-full text-left text-body-sm min-w-[520px]">
                  <thead>
                    <tr className="font-mono text-data-label text-on-surface-variant">
                      <th className="py-2 pr-2">Rank</th>
                      <th className="pr-2">Candidate</th>
                      <th className="pr-2">Score</th>
                      <th className="pr-2">Capacity</th>
                      <th className="pr-2">Transit</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.candidates.slice(0, 40).map((c) => (
                      <tr
                        key={c.id}
                        tabIndex={0}
                        role="button"
                        onClick={() => {
                          props.onSelect(c);
                          props.onPanelChange("evidence");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            props.onSelect(c);
                            props.onPanelChange("evidence");
                          }
                        }}
                        className={`border-t border-outline-variant cursor-pointer hover:bg-surface-container-low ${
                          selected?.id === c.id ? "bg-primary-fixed/25" : ""
                        } ${props.stale ? "opacity-60" : ""}`}
                      >
                        <td className="py-2 pr-2 font-mono">{c.rank}</td>
                        <td className="pr-2">{c.label}</td>
                        <td className="pr-2 font-mono">{c.score.toFixed(1)}</td>
                        <td className="pr-2 font-mono">
                          {c.metrics.find((m) => m.key === "capacity")?.value ?? "—"}
                        </td>
                        <td className="pr-2 font-mono">
                          {c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? "—"}m
                        </td>
                        <td>
                          <span className="text-caption whitespace-nowrap">{c.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {result.aggregateMetrics
                  .filter((m) => m.key !== "housing_target_gap")
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
                    <ProvenanceChip kind="copilot_recommendation" />
                    <span className="font-mono text-data-label">Score {selected.score.toFixed(1)}</span>
                    {props.housingTarget != null && (
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
                        <span className="text-on-surface-variant">{k.replace(/_/g, " ")}</span>
                        <span className="font-mono">{v}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-4 font-medium border-t border-outline-variant pt-1">
                      <span>Total score</span>
                      <span className="font-mono">{selected.score.toFixed(1)}</span>
                    </li>
                  </ul>
                  <p className="text-caption text-on-surface-variant mt-2">
                    Ranking uses weighted criteria — higher capacity alone does not guarantee rank #1.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {selected.metrics.slice(0, 6).map((m) => (
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
                    <li>Datasets: {selected.provenance.datasets.join(", ") || "—"}</li>
                    <li>Assumptions: {selected.provenance.assumptions.join(", ")}</li>
                    <li>Constraints: {selected.provenance.constraints.join("; ")}</li>
                    <li>
                      Limitations: {selected.provenance.limitations.join("; ") || "None noted"}
                    </li>
                  </ul>
                </div>
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

function EvidenceView({
  workspace,
  scenarioId,
}: {
  workspace: WorkspaceSnapshot;
  scenarioId: string;
}) {
  const scenario = workspace.scenarios.find((s) => s.id === scenarioId)!;
  return (
    <main className="flex-1 overflow-auto p-8">
      <h2 className="text-display mb-2">Evidence &amp; Data</h2>
      <p className="text-body-sm text-on-surface-variant mb-6">
        Source datasets, versions, coverage, and limitations for this workspace.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        {workspace.datasets.map((d) => (
          <div key={d.id} className="border border-outline-variant bg-surface-container-lowest p-4">
            <div className="flex justify-between gap-2 mb-2">
              <h3 className="text-headline-md">{d.name}</h3>
              <ProvenanceChip kind="source_data" />
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
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Updated</dt>
                <dd>{new Date(d.updatedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase text-on-surface-variant">Coverage</dt>
                <dd>{d.coverage}</dd>
              </div>
            </dl>
            {d.synthetic && (
              <p className="mt-2 text-caption text-secondary">Synthetic seed data — not authoritative.</p>
            )}
            {d.stale && (
              <p className="mt-2 text-caption text-error">Marked outdated.</p>
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
              Enabled: {d.enabled ? "yes" : "no"} · Features: {d.featureCount}
            </p>
          </div>
        ))}
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

const COMPARE_METRICS: Array<{ key: string; label: string }> = [
  { key: "eligible_count", label: "Eligible areas" },
  { key: "total_capacity", label: "Est. housing capacity" },
  { key: "avg_transit_distance", label: "Avg transit distance (m)" },
  { key: "top_score", label: "Top candidate score" },
];

function CompareView(props: {
  workspace: WorkspaceSnapshot;
  compareIds: string[];
  setCompareIds: Dispatch<SetStateAction<string[]>>;
  comparison: Array<Record<string, string | number>> | null;
  busy?: boolean;
  onCompare: () => Promise<void>;
  onPrefer: (id: string) => Promise<void>;
}) {
  const { workspace } = props;
  return (
    <main className="flex-1 overflow-auto p-8">
      <h2 className="text-display mb-2">Scenario comparison</h2>
      <p className="text-body-sm text-on-surface-variant mb-6">
        Select two or more scenarios, then compare using consistent calculated metrics.
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        {workspace.scenarios.map((s) => {
          const on = props.compareIds.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                props.setCompareIds((prev) =>
                  on ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                )
              }
              className={`px-3 py-1.5 border text-body-sm transition-colors ${
                on ? "border-primary bg-primary-fixed/30 text-primary" : "border-outline-variant"
              }`}
            >
              {s.name}
              {on && (
                <span className="ml-2 font-mono text-[10px] text-primary-container">✓</span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={props.compareIds.length < 2 || props.busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void props.onCompare();
        }}
        className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-40 mb-6"
      >
        {props.busy ? "Comparing…" : `Compare selected (${props.compareIds.length})`}
      </button>
      {props.comparison && props.comparison.length > 0 && (
        <div className="overflow-auto border border-outline-variant bg-surface-container-lowest">
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
                        {row[key] ?? "—"}
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
    </main>
  );
}

function DecisionView(props: {
  workspace: WorkspaceSnapshot;
  scenario: WorkspaceSnapshot["scenarios"][0];
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  reason: string;
  setReason: (v: string) => void;
  error: string | null;
  onDecide: (type: "approve_scenario" | "reject_scenario" | "request_changes") => Promise<void>;
}) {
  const { scenario, result } = props;
  return (
    <main className="flex-1 overflow-auto p-8 max-w-3xl">
      <h2 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
        Review decision
      </h2>
      <h3 className="text-display mb-6">{scenario.name}</h3>
      <div className="mb-4">
        <ProvenanceChip kind="copilot_recommendation" />
        <p className="text-body-sm mt-2">
          {result?.candidates[0]
            ? `Copilot recommends ${result.candidates[0].label} (score ${result.candidates[0].score}).`
            : "No recommendation available yet."}
        </p>
      </div>
      <section className="mb-6 border border-outline-variant p-4 space-y-3">
        <h4 className="font-mono text-data-label uppercase">Evidence summary</h4>
        <p className="text-body-sm">
          <strong>Objective:</strong> {scenario.objective.rawText}
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
          <strong>Limitations:</strong> {result?.limitations.join("; ") || "None recorded"}
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
          placeholder="Required for approve/reject — logged in audit trail"
        />
        {props.error && (
          <p className="text-caption text-error mt-1">{props.error}</p>
        )}
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => props.onDecide("approve_scenario")}
          className="bg-secondary text-on-secondary px-4 py-2 rounded text-body-sm"
        >
          Approve scenario
        </button>
        <button
          type="button"
          onClick={() => props.onDecide("request_changes")}
          className="border border-outline px-4 py-2 rounded text-body-sm"
        >
          Request changes
        </button>
        <button
          type="button"
          onClick={() => props.onDecide("reject_scenario")}
          className="border border-error text-error px-4 py-2 rounded text-body-sm"
        >
          Reject
        </button>
      </div>
      <p className="mt-4 text-caption text-on-surface-variant">
        Current decision status:{" "}
        <span className="font-medium text-secondary">{scenario.decisionStatus}</span>
      </p>
      <div className="mt-8 max-h-[40vh] overflow-y-auto">
        <h4 className="font-mono text-data-label uppercase mb-3">Decision history</h4>
        <ul className="space-y-2">
          {props.workspace.decisions
            .filter((d) => d.scenarioId === scenario.id)
            .map((d) => (
              <li key={d.id} className="text-body-sm border-b border-outline-variant pb-2">
                <span className="font-mono text-caption text-on-surface-variant">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
                <div>
                  <ProvenanceChip kind="planner_decision" /> {d.type}
                  {d.reason ? ` — ${d.reason}` : ""}
                </div>
              </li>
            ))}
        </ul>
      </div>
    </main>
  );
}

function ActivityView(props: {
  workspace: WorkspaceSnapshot;
  selected: WorkspaceSnapshot["activities"][0] | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <main className="flex-1 min-h-0 overflow-hidden grid md:grid-cols-[1fr_360px]">
      <div className="overflow-y-auto p-6 min-h-0">
        <h2 className="text-display mb-4">Activity &amp; provenance</h2>
        <ul className="space-y-3">
          {props.workspace.activities.map((a) => (
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
                    {a.actor} · {a.category}
                  </span>
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {new Date(a.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="text-body-sm">{a.summary}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <aside className="border-l border-outline-variant p-6 overflow-y-auto bg-surface-container-low min-h-0">
        <h3 className="text-headline-md mb-4">Event details</h3>
        {!props.selected ? (
          <p className="text-body-sm text-on-surface-variant">Select an event.</p>
        ) : (
          <div className="space-y-4 text-body-sm">
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">What happened</div>
              <p>{props.selected.summary}</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-outline mb-1">Action</div>
              <p className="font-mono">{props.selected.action}</p>
            </div>
            {props.selected.inputs && (
              <div>
                <div className="font-mono text-[10px] uppercase text-outline mb-1">Inputs</div>
                <pre className="text-caption whitespace-pre-wrap bg-surface p-2 border border-outline-variant">
                  {JSON.stringify(props.selected.inputs, null, 2)}
                </pre>
              </div>
            )}
            {props.selected.outputs && (
              <div>
                <div className="font-mono text-[10px] uppercase text-outline mb-1">Outputs</div>
                <pre className="text-caption whitespace-pre-wrap bg-surface p-2 border border-outline-variant">
                  {JSON.stringify(props.selected.outputs, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </aside>
    </main>
  );
}

function ReportView(props: {
  workspace: WorkspaceSnapshot;
  report: WorkspaceSnapshot["reports"][0] | null;
  onGenerate: () => Promise<void>;
}) {
  const latest = props.report ?? props.workspace.reports[0];

  function downloadMarkdown() {
    if (!latest) return;
    const lines = [
      `# ${latest.title}`,
      ``,
      `Generated: ${new Date(latest.createdAt).toLocaleString()}`,
      `Audience: ${latest.audience}`,
      ``,
    ];
    for (const s of latest.sections) {
      lines.push(`## ${s.heading}`, ``, s.body, ``);
      if (s.data && Array.isArray(s.data)) {
        lines.push(
          `| Scenario | Eligible | Capacity | Avg transit (m) | Top score |`,
          `| --- | ---: | ---: | ---: | ---: |`
        );
        for (const row of s.data as Array<Record<string, string | number>>) {
          lines.push(
            `| ${row.name} | ${row.eligible_count ?? "—"} | ${row.total_capacity ?? "—"} | ${row.avg_transit_distance ?? "—"} | ${row.top_score ?? "—"} |`
          );
        }
        lines.push(``);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${latest.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="flex-1 overflow-auto p-8 max-w-4xl">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h2 className="text-display">Reports</h2>
        <div className="flex gap-2">
          {latest && (
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
            onClick={props.onGenerate}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm"
          >
            Generate report
          </button>
        </div>
      </div>
      {!latest ? (
        <p className="text-body-sm text-on-surface-variant">No reports yet.</p>
      ) : (
        <article className="border border-outline-variant bg-surface-container-lowest p-8 space-y-6">
          <header>
            <h1 className="text-headline-md mb-1">{latest.title}</h1>
            <p className="text-caption text-on-surface-variant">
              Generated {new Date(latest.createdAt).toLocaleString()} · Audience: {latest.audience}
            </p>
          </header>
          {latest.sections.map((s, i) => (
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
              {s.data != null && Array.isArray(s.data) && (
                <div className="mt-3 overflow-auto border border-outline-variant">
                  <table className="w-full text-body-sm">
                    <thead className="bg-surface-container-low font-mono text-data-label">
                      <tr>
                        <th className="p-2 text-left">Scenario</th>
                        <th className="p-2 text-right">Eligible</th>
                        <th className="p-2 text-right">Capacity</th>
                        <th className="p-2 text-right">Avg transit (m)</th>
                        <th className="p-2 text-right">Top score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(s.data as Array<Record<string, string | number>>).map((row) => (
                        <tr key={String(row.scenarioId)} className="border-t border-outline-variant">
                          <td className="p-2">{row.name}</td>
                          <td className="p-2 text-right font-mono">{row.eligible_count ?? "—"}</td>
                          <td className="p-2 text-right font-mono">{row.total_capacity ?? "—"}</td>
                          <td className="p-2 text-right font-mono">
                            {row.avg_transit_distance ?? "—"}
                          </td>
                          <td className="p-2 text-right font-mono">{row.top_score ?? "—"}</td>
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
    </main>
  );
}
