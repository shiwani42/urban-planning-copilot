"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AppHeader } from "@/components/AppHeader";
import { assessObjectiveQuality } from "@/lib/domain/objective";
import {
  EXPLORE_CONVERT_KEY,
  EXPLORE_SESSION_KEY,
  buildExploreConvertDraft,
  type ExploreAnalysisType,
  type ExploreInvestigationResult,
} from "@/lib/domain/explore";
import { formatLocaleDateTime } from "@/lib/format";
import type { Candidate, DatasetMeta } from "@/lib/domain/types";

const ExploreMap = dynamic(
  () => import("@/components/ExploreMap").then((m) => m.ExploreMap),
  { ssr: false, loading: () => <div className="h-[360px] bg-surface-container-low animate-pulse rounded" /> }
);

const EXAMPLE_QUESTIONS = [
  "Where are transit accessibility gaps largest?",
  "Which neighborhoods are underserved by schools?",
  "Where could 500 additional homes fit near transit?",
  "Which areas have the highest flood exposure?",
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
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showMethodology, setShowMethodology] = useState(false);
  const findingsRef = useRef<HTMLElement>(null);
  const hydrated = useRef(false);

  const objectiveQuality = useMemo(() => assessObjectiveQuality(question), [question]);

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

  const selected = result?.candidates.find((c) => c.id === selectedId);

  const investigate = useCallback(async () => {
    const q = question.trim();
    if (!q) {
      setError("Enter a spatial question to investigate.");
      return;
    }
    if (!objectiveQuality.interpretable) {
      setError(
        objectiveQuality.warning ??
          "This question is too vague to investigate. Add spatial planning context."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Investigation failed");
      setResult(data);
      setSelectedId(data.candidates[0]?.id);
      setShowMethodology(false);
      requestAnimationFrame(() => {
        findingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Investigation failed");
    } finally {
      setBusy(false);
    }
  }, [question, objectiveQuality]);

  function handleConvert() {
    if (!result) return;
    const draft = buildExploreConvertDraft(result);
    try {
      sessionStorage.setItem(EXPLORE_CONVERT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader active="explore" />
      <main className="flex-1 max-w-6xl w-full mx-auto px-section-padding py-8">
        <h1 className="text-display mb-3">City discovery</h1>
        <p className="text-body-lg text-on-surface-variant mb-6">
          Investigate spatial patterns in a scratch session — no project is created until you
          convert findings into a formal planning workspace.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuestion(example)}
              className="text-caption border border-outline-variant px-3 py-1 rounded hover:border-primary"
            >
              {example}
            </button>
          ))}
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a spatial question — transit gaps, school access, flood exposure, or housing siting…"
          rows={4}
          className="w-full border border-outline-variant rounded p-3 text-body-sm mb-2"
        />
        {error && (
          <p className="text-body-sm text-error mb-3" role="alert">
            {error}
          </p>
        )}
        {!error && question.trim() && !objectiveQuality.interpretable && (
          <p className="text-body-sm text-secondary mb-3" role="status">
            {objectiveQuality.warning}
          </p>
        )}
        <div className="flex flex-wrap gap-3 items-center mb-8">
          <button
            type="button"
            onClick={investigate}
            disabled={busy || !question.trim()}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-50"
          >
            {busy ? "Investigating…" : "Investigate"}
          </button>
          {result ? (
            <Link
              href="/new"
              onClick={handleConvert}
              className="text-body-sm text-primary hover:underline"
            >
              Convert to planning project →
            </Link>
          ) : (
            <span className="text-caption text-on-surface-variant">
              Run an investigation to enable conversion
            </span>
          )}
        </div>

        {result && (
          <section
            ref={findingsRef}
            className="border border-outline-variant bg-surface-container-lowest p-6 space-y-5"
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
                  className="text-caption border border-outline-variant px-2 py-1 rounded hover:border-primary"
                >
                  {showMethodology ? "Hide methodology" : "Methodology & evidence"}
                </button>
                <button
                  type="button"
                  onClick={() => exportCsv(result)}
                  className="text-caption border border-outline-variant px-2 py-1 rounded hover:border-primary"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportGeoJson(result)}
                  className="text-caption border border-outline-variant px-2 py-1 rounded hover:border-primary"
                >
                  Export GeoJSON
                </button>
              </div>
            </div>

            <p className="text-body-sm">{result.summary}</p>
            {result.limitations.length > 0 && (
              <ul className="text-caption text-secondary list-disc pl-5 space-y-1">
                {result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}

            {showMethodology && (
              <div className="border border-outline-variant bg-surface p-4 space-y-3 text-body-sm">
                <h3 className="font-medium">Methodology</h3>
                <p className="text-caption text-on-surface-variant">
                  Sorted by <strong>{result.methodology.sortKey}</strong> (rank = sort order).
                </p>
                <div>
                  <div className="font-mono text-data-label text-on-surface-variant uppercase mb-1">
                    Weights
                  </div>
                  <ul className="text-caption space-y-1">
                    {result.methodology.weights.map((w) => (
                      <li key={w.key}>
                        {w.label}: {Math.round(w.weight * 100)}%
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="font-mono text-data-label text-on-surface-variant uppercase mb-1">
                    Datasets
                  </div>
                  <p className="text-caption">{result.methodology.datasets.join(" · ")}</p>
                </div>
                <div>
                  <div className="font-mono text-data-label text-on-surface-variant uppercase mb-1">
                    Steps
                  </div>
                  <ol className="text-caption list-decimal pl-5 space-y-1">
                    {result.methodology.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {result.aggregateMetrics.slice(0, 4).map((m) => (
                <div key={m.key} className="border border-outline-variant p-3">
                  <div className="font-mono text-[10px] uppercase text-on-surface-variant">
                    {m.label}
                  </div>
                  <div className="font-mono text-headline-md">
                    {m.value.toLocaleString()}
                    {m.unit ? ` ${m.unit}` : ""}
                  </div>
                </div>
              ))}
            </div>

            {result.layerData && (
              <ExploreMap
                layerData={result.layerData}
                candidates={result.candidates}
                selectedId={selectedId}
                analysisType={result.analysisType}
                onSelectCandidate={(c) => setSelectedId(c.id)}
              />
            )}

            {result.candidates.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="font-mono text-data-label text-on-surface-variant">
                      <th className="text-left py-2">Rank</th>
                      <th className="text-left">Area</th>
                      <th className="text-left">{scoreColumnLabel(result.analysisType)}</th>
                      <th className="text-left">{distanceColumnLabel(result.analysisType)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.candidates.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-t border-outline-variant cursor-pointer ${
                          selectedId === c.id ? "bg-primary/10" : "hover:bg-surface-container"
                        }`}
                        onClick={() => setSelectedId(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId(c.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-pressed={selectedId === c.id}
                      >
                        <td className="py-2 font-mono">{c.rank}</td>
                        <td>{c.label}</td>
                        <td className="font-mono">{c.score.toFixed(1)}</td>
                        <td className="font-mono">{distanceValue(c, result.analysisType)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.totalCandidates > result.displayedCount && (
                  <p className="text-caption text-on-surface-variant mt-2">
                    Showing top {result.displayedCount} of {result.totalCandidates} areas.
                  </p>
                )}
              </div>
            )}

            {selected && (
              <div className="border border-outline-variant bg-surface p-4 space-y-3">
                <h3 className="text-body-sm font-medium">
                  Evidence — {selected.label} (rank {selected.rank})
                </h3>
                <div className="grid sm:grid-cols-2 gap-2 text-caption">
                  {selected.metrics.slice(0, 8).map((m) => (
                    <div key={m.key} className="flex justify-between gap-2 border-b border-outline-variant/50 py-1">
                      <span className="text-on-surface-variant">{m.label}</span>
                      <span className="font-mono">
                        {m.value.toLocaleString()}
                        {m.unit ? ` ${m.unit}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="font-mono text-data-label uppercase text-on-surface-variant mb-1">
                    Score breakdown (weighted contribution)
                  </div>
                  <ul className="text-caption space-y-1">
                    {Object.entries(selected.provenance.scoreBreakdown).map(([k, v]) => (
                      <li key={k}>
                        {k}: {typeof v === "number" ? v.toFixed(2) : v}
                      </li>
                    ))}
                  </ul>
                </div>
                {selected.provenance.limitations.length > 0 && (
                  <div>
                    <div className="font-mono text-data-label uppercase text-on-surface-variant mb-1">
                      Limitations
                    </div>
                    <ul className="text-caption list-disc pl-5">
                      {selected.provenance.limitations.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
