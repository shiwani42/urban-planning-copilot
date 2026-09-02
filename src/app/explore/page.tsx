"use client";

import { useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import type { Candidate } from "@/lib/domain/types";

const EXAMPLE_QUESTIONS = [
  "Where are transit accessibility gaps largest?",
  "Which neighborhoods are underserved by schools?",
  "Where could 500 additional homes fit near transit?",
];

type ExploreResult = {
  summary: string;
  limitations: string[];
  candidates: Candidate[];
  aggregateMetrics: Array<{ key: string; label: string; value: number; unit?: string }>;
};

export default function ExplorePage() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResult | null>(null);

  async function investigate() {
    const q = question.trim();
    if (!q) {
      setError("Enter a spatial question to investigate.");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Investigation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader active="explore" />
      <main className="flex-1 max-w-4xl w-full mx-auto px-section-padding py-12">
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
          placeholder="Where are transit accessibility gaps largest?"
          rows={4}
          className="w-full border border-outline-variant rounded p-3 text-body-sm mb-2"
        />
        {error && (
          <p className="text-body-sm text-error mb-3" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3 items-center mb-8">
          <button
            type="button"
            onClick={investigate}
            disabled={busy}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-50"
          >
            {busy ? "Investigating…" : "Investigate"}
          </button>
          <Link href="/new" className="text-body-sm text-primary hover:underline">
            Convert to planning project →
          </Link>
        </div>

        {result && (
          <section className="border border-outline-variant bg-surface-container-lowest p-6 space-y-4">
            <h2 className="text-headline-md">Scratch findings</h2>
            <p className="text-body-sm">{result.summary}</p>
            {result.limitations.length > 0 && (
              <p className="text-caption text-secondary">
                <strong>Limitations:</strong> {result.limitations.join("; ")}
              </p>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
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
            {result.candidates.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="font-mono text-data-label text-on-surface-variant">
                      <th className="text-left py-2">Rank</th>
                      <th className="text-left">Area</th>
                      <th className="text-left">Score</th>
                      <th className="text-left">Transit (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.candidates.slice(0, 15).map((c) => (
                      <tr key={c.id} className="border-t border-outline-variant">
                        <td className="py-2 font-mono">{c.rank}</td>
                        <td>{c.label}</td>
                        <td className="font-mono">{c.score.toFixed(1)}</td>
                        <td className="font-mono">
                          {c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
