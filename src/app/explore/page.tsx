"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AppHeader } from "@/components/AppHeader";
import { ServerWakeBanner } from "@/components/ServerWakeBanner";
import {
  assessExploreQuestion,
  buildExploreConvertDraft,
  exploreObjectiveTextForProject,
  EXPLORE_CONVERT_KEY,
  EXPLORE_SESSION_KEY,
  type ExploreAnalysisType,
  type ExploreCandidateRow,
  type ExploreInvestigationResult,
} from "@/lib/domain/explore";
import { filterAnalysisCaveats } from "@/lib/domain/caveats";
import { fetchJsonWithServerWake } from "@/lib/server-wake";
import { formatLocaleDateTime } from "@/lib/format";
import {
  NEW_PROJECT_CREATE_VERIFY_FAILED,
  PLANNER_GEOGRAPHY_LABEL,
} from "@/lib/planner-copy";
import type { Candidate, DatasetMeta } from "@/lib/domain/types";

const EXPLORE_PAGE_SIZE = 15;

const ExploreMap = dynamic(
  () => import("@/components/ExploreMap").then((m) => m.ExploreMap),
  { ssr: false, loading: () => <div className="h-full bg-surface-container-low animate-pulse" /> }
);

const EXAMPLE_QUESTIONS = [
  "Where are transit accessibility gaps largest?",
  "Which neighborhoods are underserved by schools?",
  "Where could 500 additional homes fit near transit?",
  "Which areas have the highest flood exposure?",
];

const SUGGESTED_CHIPS = [
  "Transit accessibility",
  "Housing capacity",
  "Flood exposure",
  "School access",
  "Infrastructure gaps",
];

type ExploreResult = ExploreInvestigationResult & {
  layerData?: {
    parcels?: GeoJSON.FeatureCollection;
    transit?: GeoJSON.FeatureCollection;
    flood?: GeoJSON.FeatureCollection;
    schools?: GeoJSON.FeatureCollection;
  };
  datasets?: DatasetMeta[];
};

function scoreColumnLabel(analysisType: ExploreAnalysisType): string {
  switch (analysisType) {
    case "transit_gap":
      return "Gap score";
    case "school_gap":
      return "Access gap";
    case "flood_exposure":
      return "Exposure";
    default:
      return "Score";
  }
}

function distanceColumnLabel(analysisType: ExploreAnalysisType): string {
  switch (analysisType) {
    case "school_gap":
      return "School (m)";
    case "flood_exposure":
      return "Flood";
    default:
      return "Transit (m)";
  }
}

function distanceValue(c: Candidate, analysisType: ExploreAnalysisType): string {
  if (analysisType === "school_gap") {
    const v = c.metrics.find((m) => m.key === "school_distance_m")?.value;
    return v != null && v >= 0 ? String(v) : "—";
  }
  if (analysisType === "flood_exposure") {
    const v = c.metrics.find((m) => m.key === "flood_exposure_score")?.value;
    return v != null ? v.toFixed(1) : "—";
  }
  const v = c.metrics.find((m) => m.key === "transit_distance_m")?.value;
  return v != null && v >= 0 ? String(v) : "—";
}

function exportCsv(result: ExploreResult) {
  const headers = ["rank", "id", "label", "score", "analysis_type"];
  const rows = result.candidates.map((c) =>
    [c.rank, c.id, JSON.stringify(c.label), c.score, result.analysisType].join(",")
  );
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
    type: "text/csv",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "explore-findings.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function exportGeoJson(result: ExploreResult) {
  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: result.candidates.map((c) => ({
      type: "Feature",
      id: c.id,
      geometry: c.geometry,
      properties: {
        label: c.label,
        rank: c.rank,
        score: c.score,
        analysisType: result.analysisType,
      },
    })),
  };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "explore-findings.geojson";
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExplorePage() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showMethodology, setShowMethodology] = useState(false);
  const [listLimit, setListLimit] = useState(EXPLORE_PAGE_SIZE);
  const findingsRef = useRef<HTMLElement>(null);
  const hydrated = useRef(false);

  const exploreAssessment = useMemo(() => assessExploreQuestion(question), [question]);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = sessionStorage.getItem(EXPLORE_SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw) as {
          question?: string;
          result?: ExploreResult;
        };
        if (session.question) setQuestion(session.question);
        if (session.result) {
          setResult(session.result);
          setSelectedId(session.result.candidates[0]?.id);
        }
      }
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setQuestion(q);
  }, []);

  useEffect(() => {
    if (!result && !question.trim()) return;
    try {
      sessionStorage.setItem(
        EXPLORE_SESSION_KEY,
        JSON.stringify({ question, result })
      );
    } catch {
      /* storage unavailable */
    }
  }, [question, result]);

  const candidateRows: ExploreCandidateRow[] = useMemo(() => {
    if (!result) return [];
    if (result.candidateRows?.length) return result.candidateRows;
    return result.candidates.map((c) => ({
      id: c.id,
      label: c.label,
      rank: c.rank,
      score: c.score,
      metrics: c.metrics,
    }));
  }, [result]);

  const visibleRows = useMemo(
    () => candidateRows.slice(0, listLimit),
    [candidateRows, listLimit]
  );

  const selectedRow = candidateRows.find((c) => c.id === selectedId);
  const selectedCandidate = result?.candidates.find((c) => c.id === selectedId);

  async function handleConvert() {
    if (!result || convertBusy) return;
    setConvertError(null);
    setConvertBusy(true);
    try {
      const draft = buildExploreConvertDraft(result);
      const objectiveText = exploreObjectiveTextForProject(draft);
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.suggestedName,
          objectiveText,
          geographyLabel: PLANNER_GEOGRAPHY_LABEL,
          mode: "planning",
          fromExplore: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : "Failed to create planning workspace from Explore findings.";
        throw new Error(message);
      }
      const projectId = data?.project?.id as string | undefined;
      if (!projectId) {
        throw new Error(
          "Workspace was created but the server response did not include a project id."
        );
      }
      const verify = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      if (!verify.ok) {
        throw new Error(
          NEW_PROJECT_CREATE_VERIFY_FAILED
        );
      }
      try {
        sessionStorage.removeItem(EXPLORE_CONVERT_KEY);
        sessionStorage.removeItem("upc-new-project-draft");
        sessionStorage.removeItem(EXPLORE_SESSION_KEY);
      } catch {
        /* ignore */
      }
      await router.push(`/workspace/${projectId}`);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Could not create a planning workspace from these findings.";
      setConvertError(message);
      setConvertBusy(false);
    }
  }

  const investigate = useCallback(async () => {
    const q = question.trim();
    if (!q) {
      setError("Enter a spatial question to investigate.");
      return;
    }
    if (!exploreAssessment.interpretable || !exploreAssessment.supported) {
      setError(
        exploreAssessment.warning ??
          "This question is too vague or unsupported. Try transit gaps, school access, flood exposure, or housing siting."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJsonWithServerWake<ExploreResult>(
        "/api/explore",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
        },
        { label: "Explore investigation", retries: 2 }
      );
      setResult(data);
      setSelectedId(data.candidates[0]?.id);
      setListLimit(EXPLORE_PAGE_SIZE);
      setShowMethodology(false);
      requestAnimationFrame(() => {
        findingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Investigation failed");
    } finally {
      setBusy(false);
    }
  }, [question, exploreAssessment]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader active="explore" />
      <ServerWakeBanner />
      <main className="flex-1 flex flex-col min-h-0">
        <div className="relative flex-1 min-h-[480px] flex flex-col">
          <div className="absolute inset-0 z-0">
            <ExploreMap
              fill
              layerData={result?.layerData}
              candidates={result?.candidates ?? []}
              selectedId={selectedId}
              analysisType={result?.analysisType}
              onSelectCandidate={(c) => setSelectedId(c.id)}
            />
          </div>

          <div className="relative z-10 flex flex-col lg:flex-row gap-6 p-section-padding flex-1 pointer-events-none">
            <div
              className="w-full lg:w-[min(420px,100%)] glass-panel border border-outline-variant rounded p-6 pointer-events-auto shadow-sm"
            >
              <h1 className="text-display mb-2 text-primary">City discovery</h1>
              <p className="text-body-sm text-on-surface-variant mb-4">
                Investigate spatial patterns in a scratch session — convert findings into a formal
                workspace when ready.
              </p>

              <div className="mb-4">
                <p className="font-mono text-data-label text-on-surface-variant uppercase mb-2 tracking-wide">
                  Example questions
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_QUESTIONS.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setQuestion(example)}
                      className="text-caption border border-outline-variant px-3 py-1.5 rounded hover:border-primary-container text-on-surface text-left"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block font-mono text-data-label text-on-surface-variant uppercase mb-2 tracking-wide">
                Spatial question
              </label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about transit gaps, school access, flood exposure, or housing siting…"
                rows={3}
                className="w-full border border-outline-variant rounded p-3 text-body-sm mb-3 bg-surface-container-lowest focus:border-primary-container focus:outline-none"
              />

              <div className="mb-4">
                <p className="font-mono text-data-label text-on-surface-variant uppercase mb-2 tracking-wide">
                  Suggested explorations
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() =>
                        setQuestion((prev) =>
                          prev.trim() ? prev : `Explore ${chip.toLowerCase()} in the study area`
                        )
                      }
                      className="inline-flex items-center px-3 py-1.5 rounded border border-outline-variant bg-surface hover:bg-surface-container text-body-sm text-on-surface"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p className="text-body-sm text-error mb-3" role="alert">{error}</p>
              )}
              {!error && question.trim() && !exploreAssessment.supported && (
                <p className="text-body-sm text-secondary mb-3" role="status">
                  {exploreAssessment.warning}
                </p>
              )}
              {convertError && (
                <p className="text-body-sm text-error mb-3" role="alert">{convertError}</p>
              )}

              <div className="flex flex-wrap gap-3 items-center">
                <button
                  type="button"
                  onClick={investigate}
                  disabled={busy || !question.trim()}
                  className="bg-primary-container text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-50 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                  {busy ? "Investigating…" : "Run exploration"}
                </button>
                {result ? (
                  <button
                    type="button"
                    onClick={() => void handleConvert()}
                    disabled={convertBusy}
                    className="text-body-sm text-primary-container hover:underline disabled:opacity-50"
                  >
                    {convertBusy ? "Creating workspace…" : "Convert to planning project →"}
                  </button>
                ) : question.trim() ? (
                  <span className="text-caption text-on-surface-variant">
                    Run exploration to see findings on the map.
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {result && (
          <section
            ref={findingsRef}
            className="border-t border-outline-variant bg-surface-container-lowest p-section-padding space-y-5 pointer-events-auto"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-headline-md">Scratch findings</h2>
                <p className="text-caption text-on-surface-variant mt-1">
                  <strong>Question:</strong> {result.question}
                </p>
                <p className="text-caption text-on-surface-variant">
                  Investigated {formatLocaleDateTime(result.investigatedAt)} ·{" "}
                  {result.analysisType.replace(/_/g, " ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowMethodology((v) => !v)}
                  className="text-caption border border-outline-variant px-2 py-1 rounded hover:border-primary-container"
                >
                  {showMethodology ? "Hide methodology" : "Methodology & evidence"}
                </button>
                <button
                  type="button"
                  onClick={() => exportCsv(result)}
                  className="text-caption border border-outline-variant px-2 py-1 rounded hover:border-primary-container"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportGeoJson(result)}
                  className="text-caption border border-outline-variant px-2 py-1 rounded hover:border-primary-container"
                >
                  Export GeoJSON
                </button>
              </div>
            </div>

            <p className="text-body-sm">{result.summary}</p>
            {result.limitations.length > 0 && (() => {
              const filtered = filterAnalysisCaveats(result.limitations, { max: 8 });
              return (
                <ul className="text-caption text-secondary list-disc pl-5 space-y-1">
                  {filtered.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              );
            })()}

            {showMethodology && (
              <div className="border border-outline-variant bg-surface p-4 space-y-3 text-body-sm rounded">
                <h3 className="font-medium">Methodology</h3>
                <p className="text-caption text-on-surface-variant">
                  Sorted by <strong>{result.methodology.sortKey}</strong> (rank = sort order).
                </p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {result.aggregateMetrics.slice(0, 4).map((m) => (
                <div key={m.key} className="border border-outline-variant p-3 rounded bg-surface">
                  <div className="font-mono text-data-label uppercase text-on-surface-variant text-[10px]">
                    {m.label}
                  </div>
                  <div className="font-mono text-headline-md">
                    {m.value.toLocaleString()}
                    {m.unit ? ` ${m.unit}` : ""}
                  </div>
                </div>
              ))}
            </div>

            {candidateRows.length > 0 && (
              <div className="overflow-auto border border-outline-variant rounded bg-surface">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="font-mono text-data-label text-on-surface-variant bg-surface-container-low">
                      <th className="text-left py-2 px-3">Rank</th>
                      <th className="text-left px-3">Area</th>
                      <th className="text-left px-3">{scoreColumnLabel(result.analysisType)}</th>
                      <th className="text-left px-3">{distanceColumnLabel(result.analysisType)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-t border-outline-variant cursor-pointer ${
                          selectedId === c.id ? "bg-primary-fixed/20" : "hover:bg-surface-container"
                        }`}
                        onClick={() => setSelectedId(c.id)}
                        tabIndex={0}
                        role="button"
                        aria-pressed={selectedId === c.id}
                      >
                        <td className="py-2 px-3 font-mono">{c.rank}</td>
                        <td className="px-3">{c.label}</td>
                        <td className="px-3 font-mono">{c.score.toFixed(1)}</td>
                        <td className="px-3 font-mono">
                          {distanceValue(c as Candidate, result.analysisType)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedRow && (
              <div className="border border-outline-variant bg-surface p-4 space-y-3 rounded">
                <h3 className="text-body-sm font-medium">
                  Evidence — {selectedRow.label} (rank {selectedRow.rank})
                </h3>
                <div className="grid sm:grid-cols-2 gap-2 text-caption">
                  {(selectedCandidate?.metrics ?? selectedRow.metrics).slice(0, 8).map((m) => (
                    <div
                      key={m.key}
                      className="flex justify-between gap-2 border-b border-outline-variant/50 py-1"
                    >
                      <span className="text-on-surface-variant">{m.label}</span>
                      <span className="font-mono">
                        {m.value.toLocaleString()}
                        {m.unit ? ` ${m.unit}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
