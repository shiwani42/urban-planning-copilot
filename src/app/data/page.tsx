"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DatasetMeta } from "@/lib/domain/types";
import { ProvenanceChip } from "@/components/workspace-hooks";
import { StorageBanner } from "@/components/StorageBanner";

function matchesSearch(dataset: DatasetMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    dataset.name.toLowerCase().includes(q) ||
    dataset.kind.toLowerCase().includes(q) ||
    dataset.source.toLowerCase().includes(q) ||
    dataset.coverage.toLowerCase().includes(q)
  );
}

export default function DataPage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/datasets");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load datasets");
      setDatasets(data.datasets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredDatasets = useMemo(
    () => datasets.filter((d) => matchesSearch(d, search)),
    [datasets, search]
  );

  async function patch(action: string, body: Record<string, unknown>) {
    setMutationError(null);
    const dataset = datasets.find((d) => d.id === body.datasetId);
    const label = dataset?.name ?? "this dataset";

    if (action === "mark_stale" && body.stale !== false) {
      if (
        !window.confirm(
          `Mark "${label}" as outdated in the global catalog? Scenarios that use this dataset in their analysis plan will have stale results.`
        )
      ) {
        return;
      }
    }

    if (action === "set_enabled" && body.enabled === false) {
      if (
        !window.confirm(
          `Disable "${label}" in the global catalog? It will be removed from scenario enabled lists and invalidate analyses that depend on it.`
        )
      ) {
        return;
      }
    }

    setBusyId(String(body.datasetId));
    try {
      const res = await fetch("/api/datasets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Catalog update failed");
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setMutationError(message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <StorageBanner />
      <header className="h-14 border-b border-outline-variant px-section-padding flex items-center gap-6">
        <Link href="/" className="font-display text-[18px] font-semibold text-primary">
          Urban Planning Copilot
        </Link>
        <nav className="flex gap-4 text-body-sm">
          <Link href="/" className="text-on-surface-variant hover:text-primary">
            Projects
          </Link>
          <Link href="/explore" className="text-on-surface-variant hover:text-primary">
            Explore
          </Link>
          <span className="text-primary font-medium border-b-2 border-primary">Data</span>
        </nav>
      </header>
      <main className="max-w-5xl mx-auto px-section-padding py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="flex-1 min-w-0">
            <h1 className="text-display mb-2">Evidence &amp; data explorer</h1>
            <p className="text-body-sm text-on-surface-variant">
              Manage dataset availability, freshness, and open-data provenance (PDDL snapshots) for the{" "}
              <strong>global catalog</strong>. Changes apply to every workspace immediately — disable or
              mark outdated here and Evidence tabs will reflect it.
            </p>
          </div>
          <div className="relative w-full sm:w-64 shrink-0">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none">
              search
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search datasets…"
              aria-label="Search datasets"
              className="w-full pl-10 pr-3 py-2 border border-outline-variant bg-surface-container-lowest text-body-sm focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="border border-error/40 bg-error-container/20 p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <p className="text-body-sm text-error flex-1">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="border border-outline-variant px-3 py-1.5 text-body-sm rounded shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {mutationError && (
          <div role="alert" className="border border-error/40 bg-error-container/20 p-4 mb-6">
            <p className="text-body-sm text-error">{mutationError}</p>
          </div>
        )}

        <div className="space-y-4">
          {loading ? (
            <>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="border border-outline-variant p-4 bg-surface-container-lowest animate-pulse h-32"
                />
              ))}
            </>
          ) : filteredDatasets.length === 0 ? (
            <div className="border border-outline-variant bg-surface-container-lowest p-8 text-center">
              <p className="text-body-sm text-on-surface-variant">
                {search.trim()
                  ? `No datasets match "${search.trim()}".`
                  : "No datasets in the catalog."}
              </p>
              {search.trim() && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-body-sm text-primary hover:underline mt-2"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            filteredDatasets.map((d) => (
              <div key={d.id} className="border border-outline-variant p-4 bg-surface-container-lowest">
                <div className="flex flex-wrap justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-headline-md">{d.name}</h2>
                    <p className="text-caption text-on-surface-variant">
                      {d.kind} · {d.version} · {d.featureCount} features
                      {d.dataVintage ? ` · vintage: ${d.dataVintage}` : ""}
                    </p>
                  </div>
                  <ProvenanceChip kind="source_data" />
                </div>
                <p className="text-body-sm mb-2">{d.source}</p>
                <p className="text-caption mb-3">Coverage: {d.coverage}</p>
                <ul className="text-caption text-on-surface-variant list-disc pl-4 mb-4">
                  {d.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === d.id}
                    onClick={() => patch("set_enabled", { datasetId: d.id, enabled: !d.enabled })}
                    className="border border-outline-variant px-3 py-1.5 text-body-sm rounded disabled:opacity-50"
                  >
                    {d.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === d.id}
                    onClick={() => patch("mark_stale", { datasetId: d.id, stale: !d.stale })}
                    className="border border-outline-variant px-3 py-1.5 text-body-sm rounded disabled:opacity-50"
                  >
                    {d.stale ? "Clear outdated" : "Mark outdated"}
                  </button>
                </div>
                {d.stale && (
                  <p className="text-caption text-on-surface-variant mt-3">
                    Clearing the outdated flag updates catalog metadata only — scenario results stay
                    stale until you recalculate analysis.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
