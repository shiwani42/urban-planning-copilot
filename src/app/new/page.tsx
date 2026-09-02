"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const EXAMPLES = [
  {
    title: "Housing growth",
    text: "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.",
  },
  {
    title: "Emergency shelters",
    text: "Identify three locations for emergency shelters that maximize population coverage, prioritize accessibility, and avoid flood-risk areas.",
  },
  {
    title: "Schools",
    text: "Identify neighborhoods where a new school would most improve accessibility while avoiding areas already adequately served.",
  },
  {
    title: "Transit gaps",
    text: "Find neighborhoods with the largest transit accessibility gaps and identify areas where a new transit stop could improve access.",
  },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const lower = objective.toLowerCase();
    const datasets: string[] = ["Parcels"];
    const analyses: string[] = ["Candidate filtering", "Ranking"];
    if (/transit|station|bus|rail/.test(lower)) {
      datasets.push("Transit");
      analyses.push("Transit proximity");
    }
    if (/flood/.test(lower)) {
      datasets.push("Flood risk");
      analyses.push("Flood exclusion");
    }
    if (/home|housing|unit/.test(lower)) analyses.push("Capacity estimation");
    if (/shelter|population|school/.test(lower)) {
      datasets.push("Population");
      analyses.push("Coverage / accessibility");
    }
    if (/school/.test(lower)) datasets.push("Schools");
    return { datasets, analyses };
  }, [objective]);

  async function create() {
    if (!name.trim() || !objective.trim()) {
      setError("Project name and planning objective are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          objectiveText: objective.trim(),
          geographyLabel: "Study area",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      router.push(`/workspace/${data.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-14 border-b border-outline-variant px-section-padding flex items-center justify-between">
        <Link href="/" className="text-body-sm text-primary hover:underline">
          ← Projects
        </Link>
        <h1 className="text-headline-md text-on-surface">New planning workspace</h1>
        <div className="w-20" />
      </header>

      <main className="flex-1 grid lg:grid-cols-2 gap-px bg-outline-variant">
        <section className="bg-surface p-8 overflow-y-auto">
          <label className="font-mono text-data-label text-on-surface-variant uppercase block mb-2">
            Project name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. North River Housing Strategy"
            className="w-full border-b border-outline bg-transparent py-2 mb-6 text-body-lg focus:outline-none focus:border-primary"
          />

          <label className="font-mono text-data-label text-on-surface-variant uppercase block mb-2">
            Planning objective
          </label>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={5}
            placeholder="Describe the planning question in natural language…"
            className="w-full border border-outline-variant rounded bg-surface-container-lowest p-3 text-body-sm focus:outline-none focus:border-primary mb-6"
          />

          <h2 className="font-mono text-data-label text-on-surface-variant uppercase mb-3">
            Example questions
          </h2>
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.title}
                type="button"
                onClick={() => {
                  setObjective(ex.text);
                  if (!name) setName(ex.title);
                }}
                className="text-left border border-outline-variant p-3 hover:border-primary transition-colors"
              >
                <div className="text-body-sm font-medium mb-1">{ex.title}</div>
                <div className="text-caption text-on-surface-variant line-clamp-3">{ex.text}</div>
              </button>
            ))}
          </div>

          {error && <p className="text-body-sm text-error mb-3">{error}</p>}

          <button
            onClick={create}
            disabled={busy}
            className="bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </section>

        <section className="bg-surface-container-low p-8">
          <h2 className="text-headline-md text-on-surface mb-6">What I&apos;ll prepare</h2>
          <div className="space-y-5">
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-1">Objective</div>
              <p className="text-body-sm text-on-surface-variant">
                {objective || "Enter a planning question to preview the plan."}
              </p>
            </div>
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-1">Geography</div>
              <p className="text-body-sm">Study area (synthetic seed geography)</p>
            </div>
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-2">
                Potential datasets
              </div>
              <div className="flex flex-wrap gap-2">
                {preview.datasets.map((d) => (
                  <span
                    key={d}
                    className="px-2 py-1 bg-surface border border-outline-variant font-mono text-[11px]"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-data-label uppercase text-on-surface mb-2">
                Potential analyses
              </div>
              <ul className="space-y-2">
                {preview.analyses.map((a) => (
                  <li key={a} className="text-body-sm flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      analytics
                    </span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
