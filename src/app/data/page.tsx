"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DatasetMeta } from "@/lib/domain/types";
import { ProvenanceChip } from "@/components/workspace-hooks";
import { StorageBanner } from "@/components/StorageBanner";

export default function DataPage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/datasets");
      const data = await res.json();
      setDatasets(data.datasets ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(action: string, body: Record<string, unknown>) {
    if (action === "mark_stale" && body.stale !== false) {
      const dataset = datasets.find((d) => d.id === body.datasetId);
      const label = dataset?.name ?? "this dataset";
      if (
        !window.confirm(
          `Mark "${label}" as outdated in the global catalog? Every workspace will see this flag immediately.`
        )
      ) {
        return;
      }
    }
    await fetch("/api/datasets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    await load();
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
        <h1 className="text-display mb-2">Evidence &amp; data explorer</h1>
        <p className="text-body-sm text-on-surface-variant mb-8">
          Manage dataset availability, freshness, and open-data provenance (PDDL snapshots) for the{" "}
          <strong>global catalog</strong>. Changes apply to every workspace immediately — disable or
          mark outdated here and Evidence tabs will reflect it.
        </p>
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
          ) : (
            datasets.map((d) => (
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
                  onClick={() => patch("set_enabled", { datasetId: d.id, enabled: !d.enabled })}
                  className="border border-outline-variant px-3 py-1.5 text-body-sm rounded"
                >
                  {d.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => patch("mark_stale", { datasetId: d.id, stale: !d.stale })}
                  className="border border-outline-variant px-3 py-1.5 text-body-sm rounded"
                >
                  {d.stale ? "Clear outdated" : "Mark outdated"}
                </button>
              </div>
            </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
