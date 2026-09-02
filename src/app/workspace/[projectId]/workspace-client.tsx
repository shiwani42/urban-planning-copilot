"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProvenanceChip, useWorkspace } from "@/components/workspace-hooks";
import { WebMcpProvider } from "@/components/WebMcpProvider";
import type {
  Candidate,
  CriterionWeight,
  WorkspaceSnapshot,
} from "@/lib/domain/types";

const PlanningMap = dynamic(() => import("@/components/PlanningMap"), { ssr: false });

type Tab =
  | "workspace"
  | "results"
  | "evidence"
  | "compare"
  | "decision"
  | "activity"
  | "report";

export default function WorkspaceClient({ projectId }: { projectId: string }) {
  const { workspace, loading, error, busy, act, refresh } = useWorkspace(projectId);
  const [tab, setTab] = useState<Tab>("workspace");
  const [layerData, setLayerData] = useState<Record<string, GeoJSON.FeatureCollection>>({});
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const selectCandidate = useCallback(
    async (c: Candidate) => {
      setSelectedCandidate(c);
      setDrawerOpen(true);
      setTab("results");
      await act("select_candidate", {
        candidateId: c.id,
        featureIds: c.featureIds,
      });
    },
    [act]
  );

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
              title={t}
              onClick={() => setTab(t)}
              className={`p-2 rounded transition-colors ${
                tab === t ? "bg-surface-variant" : "hover:bg-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">{icon}</span>
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

      <div className="bg-surface border-b border-outline-variant px-section-padding py-2 flex items-center gap-4 text-body-sm shrink-0 overflow-x-auto">
        <div className="flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-outline text-[18px]">flag</span>
          <span className="text-on-surface-variant">Objective</span>
          <span className="text-outline-variant">·</span>
          <span className="font-medium">
            {scenario.objective.targetValue
              ? `${scenario.objective.targetValue} ${scenario.objective.targetUnit ?? ""}`
              : scenario.objective.intent.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex gap-2">
          {scenario.objective.parsedRequirements.slice(0, 4).map((r) => (
            <span
              key={r}
              className="px-2 py-0.5 border border-outline rounded text-caption text-on-surface-variant whitespace-nowrap"
            >
              {r}
            </span>
          ))}
        </div>
        {result?.stale && (
          <span className="ml-auto text-secondary text-caption font-medium whitespace-nowrap">
            Results stale — recalculate
          </span>
        )}
        {workspace.project.resumeNote && (
          <span className="ml-auto text-caption text-on-surface-variant truncate max-w-md">
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
        <main className="flex-1 flex overflow-hidden relative">
          <aside className="w-sidebar-width bg-surface border-r border-outline-variant flex flex-col z-30 shrink-0">
            <div className="p-4 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
              <div>
                <h2 className="text-headline-md text-primary">Context</h2>
                <p className="text-caption text-on-surface-variant mt-0.5">
                  {workspace.project.geographyLabel}
                </p>
              </div>
              <span className="material-symbols-outlined text-outline">map</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
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
                    .map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2">
                        <span className="text-body-sm flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px] text-primary">
                            check_circle
                          </span>
                          {c.label}
                        </span>
                        {c.operator === "within_distance" && (
                          <input
                            type="number"
                            className="w-20 font-mono text-data-label bg-primary-fixed px-1.5 py-0.5 rounded text-primary"
                            value={Number(c.value)}
                            onChange={(e) => updateTransitThreshold(Number(e.target.value))}
                          />
                        )}
                      </div>
                    ))}
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
                    disabled={busy}
                  >
                    Apply &amp; mark stale
                  </button>
                </div>
                <div className="space-y-4">
                  {(weightDraft ?? scenario.weights).map((w, i) => (
                    <div key={w.id}>
                      <div className="flex justify-between text-caption mb-1">
                        <span>{w.label}</span>
                        <span>{Math.round(w.weight * 100)}%</span>
                      </div>
                      <input
                        type="range"
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
                        {s.status}
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
              onSelectCandidate={selectCandidate}
              drawingExclusion={drawingExclusion}
              onMapClickExclude={({ lat, lng }) => {
                setExcludeClicks((prev) => [...prev, [lng, lat]]);
              }}
            />

            <div className="absolute right-4 top-4 flex flex-col gap-2 z-20">
              <button
                onClick={() => {
                  setDrawingExclusion((v) => !v);
                  setExcludeClicks([]);
                }}
                className={`glass-panel p-2 rounded border border-outline-variant ${
                  drawingExclusion ? "bg-error-container" : ""
                }`}
                title="Draw exclusion polygon"
              >
                <span className="material-symbols-outlined">block</span>
              </button>
              {drawingExclusion && (
                <button
                  onClick={finishExclusionPolygon}
                  disabled={excludeClicks.length < 3}
                  className="glass-panel px-2 py-1 rounded border border-outline-variant text-caption disabled:opacity-40"
                >
                  Finish ({excludeClicks.length})
                </button>
              )}
            </div>

            <div className="absolute left-4 bottom-4 glass-panel p-3 rounded border border-outline-variant z-20 max-w-[220px]">
              <h4 className="font-mono text-data-label text-on-surface-variant uppercase mb-2">
                Legend
              </h4>
              <div className="space-y-1.5 text-caption">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-inverse-primary/40 border border-primary-container" />
                  Flood risk
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-primary/30 border border-primary" />
                  Candidates
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-primary rounded-full" />
                  Transit
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20">
              <button
                onClick={() => {
                  setDrawerOpen(true);
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

          <aside className="w-inspector-width bg-surface border-l border-outline-variant flex flex-col z-30 shrink-0">
            <div className="p-4 border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
              <div>
                <h2 className="text-headline-md text-primary-container">AI Copilot</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      runningJob ? "bg-primary animate-pulse" : "bg-green-600"
                    }`}
                  />
                  <p className="text-caption text-on-surface-variant">
                    {runningJob ? runningJob.currentStep ?? "Running…" : "Ready for instruction"}
                  </p>
                </div>
              </div>
              <span className="material-symbols-outlined text-outline">smart_toy</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
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
                            {new Date(a.timestamp).toLocaleTimeString()}
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

            <div className="p-4 border-t border-outline-variant bg-surface-container-lowest flex flex-col gap-3">
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
                onClick={() => setAssumptionsOpen((v) => !v)}
                className="w-full border border-outline-variant py-2 px-4 rounded text-body-sm"
              >
                Review assumptions
              </button>
            </div>
          </aside>
        </main>
      ) : null}

      {(tab === "results" && drawerOpen) || selectedCandidate ? (
        tab === "workspace" || tab === "results" ? (
          <ResultsDrawer
            open={drawerOpen || tab === "results"}
            onClose={() => setDrawerOpen(false)}
            result={result}
            selected={selectedCandidate}
            onSelect={selectCandidate}
            onReject={async (c, reason) => {
              await act("record_decision", {
                scenarioId: scenario.id,
                type: "reject_candidate",
                subjectId: c.id,
                reason,
              });
              await refresh();
            }}
            assumptions={scenario.assumptions}
            assumptionsOpen={assumptionsOpen}
            onAssumptionChange={async (assumptions) => {
              await act("update_assumptions", { scenarioId: scenario.id, assumptions });
            }}
          />
        ) : null
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
          onCompare={async () => {
            const data = await act("compare_scenarios", { scenarioIds: compareIds });
            setComparison(data.comparison);
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
          setReason={setDecisionReason}
          onDecide={async (type) => {
            await act("record_decision", {
              scenarioId: scenario.id,
              type,
              reason: decisionReason,
            });
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
  onClose: () => void;
  result: WorkspaceSnapshot["analysisResults"][0] | undefined;
  selected: Candidate | null;
  onSelect: (c: Candidate) => void;
  onReject: (c: Candidate, reason: string) => Promise<void>;
  assumptions: WorkspaceSnapshot["scenarios"][0]["assumptions"];
  assumptionsOpen: boolean;
  onAssumptionChange: (
    a: WorkspaceSnapshot["scenarios"][0]["assumptions"]
  ) => Promise<void>;
}) {
  const { result, selected } = props;
  if (!props.open) return null;

  return (
    <div className="absolute bottom-0 left-[300px] right-[360px] max-h-[45vh] bg-surface border-t border-outline-variant z-40 flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant bg-surface-container-low">
        <div className="flex gap-4">
          <span className="font-mono text-data-label text-primary border-b-2 border-primary pb-1">
            Candidates
          </span>
          <span className="font-mono text-data-label text-on-surface-variant">Evidence</span>
        </div>
        <button onClick={props.onClose} className="p-1 hover:bg-surface-variant rounded">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <div className="flex-1 overflow-auto grid md:grid-cols-2 gap-px bg-outline-variant">
        <div className="bg-surface p-4 overflow-auto">
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
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="font-mono text-data-label text-on-surface-variant">
                  <th className="py-2">Rank</th>
                  <th>Candidate</th>
                  <th>Score</th>
                  <th>Capacity</th>
                  <th>Transit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.slice(0, 40).map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => props.onSelect(c)}
                    className={`border-t border-outline-variant cursor-pointer hover:bg-surface-container-low ${
                      selected?.id === c.id ? "bg-primary-fixed/25" : ""
                    }`}
                  >
                    <td className="py-2 font-mono">{c.rank}</td>
                    <td>{c.label}</td>
                    <td className="font-mono">{c.score}</td>
                    <td className="font-mono">
                      {c.metrics.find((m) => m.key === "capacity")?.value ?? "—"}
                    </td>
                    <td className="font-mono">
                      {c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? "—"}m
                    </td>
                    <td>
                      <span className="text-caption">{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {result.aggregateMetrics.map((m) => (
                <div key={m.key} className="border border-outline-variant p-3">
                  <div className="font-mono text-[10px] text-on-surface-variant uppercase mb-1">
                    {m.label}
                  </div>
                  <div className="text-headline-md font-mono">
                    {m.value}
                    {m.unit ? ` ${m.unit}` : ""}
                  </div>
                  <ProvenanceChip kind={m.kind} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface p-4 overflow-auto">
          {!selected ? (
            <p className="text-body-sm text-on-surface-variant">
              Select a candidate to inspect evidence.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-headline-md mb-1">{selected.label}</h3>
                <div className="flex gap-2 items-center">
                  <ProvenanceChip kind="copilot_recommendation" />
                  <span className="font-mono text-data-label">Score {selected.score}</span>
                </div>
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
                  <li>Score ← weighted criteria</li>
                  {Object.entries(selected.provenance.scoreBreakdown).map(([k, v]) => (
                    <li key={k}>
                      · {k}: {v}
                    </li>
                  ))}
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

          {props.assumptionsOpen && (
            <div className="mt-6 border-t border-outline-variant pt-4">
              <h4 className="font-mono text-data-label uppercase mb-3">Assumptions</h4>
              <div className="space-y-3">
                {props.assumptions.map((a, i) => (
                  <label key={a.id} className="block text-body-sm">
                    <span className="text-on-surface-variant">{a.label}</span>
                    <input
                      disabled={!a.editable}
                      className="ml-2 border-b border-outline bg-transparent font-mono w-24"
                      value={String(a.value)}
                      onChange={(e) => {
                        const next = [...props.assumptions];
                        const raw = e.target.value;
                        next[i] = {
                          ...a,
                          value: Number.isFinite(Number(raw)) ? Number(raw) : raw,
                        };
                        props.onAssumptionChange(next);
                      }}
                    />
                    {a.unit && <span className="text-caption ml-1">{a.unit}</span>}
                    <p className="text-caption text-on-surface-variant">{a.description}</p>
                  </label>
                ))}
              </div>
            </div>
          )}
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

function CompareView(props: {
  workspace: WorkspaceSnapshot;
  compareIds: string[];
  setCompareIds: (ids: string[]) => void;
  comparison: Array<Record<string, string | number>> | null;
  onCompare: () => Promise<void>;
  onPrefer: (id: string) => Promise<void>;
}) {
  const { workspace } = props;
  return (
    <main className="flex-1 overflow-auto p-8">
      <h2 className="text-display mb-2">Scenario comparison</h2>
      <p className="text-body-sm text-on-surface-variant mb-6">
        Compare scenarios with consistent calculated metrics.
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        {workspace.scenarios.map((s) => {
          const on = props.compareIds.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() =>
                props.setCompareIds(
                  on
                    ? props.compareIds.filter((id) => id !== s.id)
                    : [...props.compareIds, s.id]
                )
              }
              className={`px-3 py-1.5 border text-body-sm ${
                on ? "border-primary bg-primary-fixed/30" : "border-outline-variant"
              }`}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      <button
        disabled={props.compareIds.length < 2}
        onClick={props.onCompare}
        className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-40 mb-6"
      >
        Compare selected
      </button>
      {props.comparison && (
        <div className="overflow-auto border border-outline-variant">
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
              {["eligible_count", "total_capacity", "avg_transit_distance", "top_score"].map(
                (metric) => (
                  <tr key={metric} className="border-t border-outline-variant">
                    <td className="p-3 font-mono text-caption">{metric}</td>
                    {props.comparison!.map((row) => (
                      <td key={String(row.scenarioId)} className="p-3 font-mono">
                        {row[metric]}
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
          className="mt-2 w-full border border-outline-variant rounded p-3 text-body-sm"
          rows={3}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => props.onDecide("approve_scenario")}
          className="bg-secondary text-on-secondary px-4 py-2 rounded text-body-sm"
        >
          Approve scenario
        </button>
        <button
          onClick={() => props.onDecide("request_changes")}
          className="border border-outline px-4 py-2 rounded text-body-sm"
        >
          Request changes
        </button>
        <button
          onClick={() => props.onDecide("reject_scenario")}
          className="border border-error text-error px-4 py-2 rounded text-body-sm"
        >
          Reject
        </button>
      </div>
      <p className="mt-4 text-caption text-on-surface-variant">
        Current decision status:{" "}
        <span className="font-medium">{scenario.decisionStatus}</span>
      </p>
      <div className="mt-8">
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
    <main className="flex-1 overflow-hidden grid md:grid-cols-[1fr_360px]">
      <div className="overflow-auto p-6">
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
      <aside className="border-l border-outline-variant p-6 overflow-auto bg-surface-container-low">
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
  return (
    <main className="flex-1 overflow-auto p-8 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-display">Reports</h2>
        <button
          onClick={props.onGenerate}
          className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm"
        >
          Generate report
        </button>
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
              <pre className="text-body-sm whitespace-pre-wrap font-sans text-on-surface-variant">
                {s.body}
              </pre>
              {s.data != null && (
                <pre className="mt-2 text-caption font-mono bg-surface-container p-2 overflow-auto">
                  {JSON.stringify(s.data, null, 2)}
                </pre>
              )}
            </section>
          ))}
        </article>
      )}
    </main>
  );
}
