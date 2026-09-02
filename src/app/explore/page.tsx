"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ExplorePage() {
  const router = useRouter();
  const [question, setQuestion] = useState(
    "Where are transit accessibility gaps largest?"
  );
  const [busy, setBusy] = useState(false);

  async function investigate() {
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Explore: Transit gaps",
        objectiveText: question,
        mode: "explore",
        geographyLabel: "Study area",
      }),
    });
    const data = await res.json();
    const projectId = data.project.id;
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "run_analysis",
        scenarioId: data.project.activeScenarioId,
      }),
    });
    router.push(`/workspace/${projectId}`);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-14 border-b border-outline-variant px-section-padding flex items-center gap-6">
        <Link href="/" className="font-display text-[18px] font-semibold text-primary">
          Urban Planning Copilot
        </Link>
        <nav className="flex gap-4 text-body-sm">
          <Link href="/" className="text-on-surface-variant hover:text-primary">
            Projects
          </Link>
          <span className="text-primary font-medium border-b-2 border-primary">Explore</span>
          <Link href="/data" className="text-on-surface-variant hover:text-primary">
            Data
          </Link>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto px-section-padding py-12">
        <h1 className="text-display mb-3">City discovery</h1>
        <p className="text-body-lg text-on-surface-variant mb-8">
          Investigate spatial patterns without committing to a formal scenario. Convert
          findings into a full planning project when ready.
        </p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={4}
          className="w-full border border-outline-variant rounded p-3 text-body-sm mb-4"
        />
        <button
          onClick={investigate}
          disabled={busy}
          className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm disabled:opacity-50"
        >
          {busy ? "Investigating…" : "Investigate"}
        </button>
      </main>
    </div>
  );
}
