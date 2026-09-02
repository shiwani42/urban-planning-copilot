"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProvenanceChip } from "@/components/workspace-hooks";

type Project = {
  id: string;
  name: string;
  updatedAt: string;
  resumeNote?: string;
  geographyLabel: string;
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .finally(() => setLoading(false));
  }, []);

  const continueProjects = useMemo(
    () => projects.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [projects]
  );

  const actionItems = useMemo(() => {
    const items: Array<{ label: string; projectId: string; kind: string }> = [];
    for (const p of projects) {
      if (p.resumeNote?.includes("pending") || p.resumeNote?.includes("Proposal")) {
        items.push({ label: p.resumeNote, projectId: p.id, kind: "manual" });
      } else if (p.resumeNote?.includes("recalculate") || p.resumeNote?.includes("stale")) {
        items.push({ label: p.resumeNote, projectId: p.id, kind: "data" });
      } else if (p.resumeNote?.includes("complete") || p.resumeNote?.includes("candidates")) {
        items.push({ label: `Review results — ${p.name}`, projectId: p.id, kind: "ai" });
      }
    }
    return items.slice(0, 3);
  }, [projects]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-16 border-b border-outline-variant bg-surface-container-high px-section-padding flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="font-display text-[22px] font-semibold text-primary tracking-tight">
            Urban Planning Copilot
          </h1>
          <nav className="flex gap-4 text-body-sm">
            <span className="text-primary font-medium border-b-2 border-primary pb-0.5">
              Projects
            </span>
            <Link href="/explore" className="text-on-surface-variant hover:text-primary">
              Explore
            </Link>
            <Link href="/data" className="text-on-surface-variant hover:text-primary">
              Data
            </Link>
          </nav>
        </div>
        <button
          onClick={() => router.push("/new")}
          className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-on-primary-fixed-variant transition-colors"
        >
          + New planning project
        </button>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-section-padding py-10">
        <div className="flex flex-col lg:flex-row lg:items-start gap-10">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
              <div>
                <h2 className="text-display text-on-surface mb-2">{greeting()}, planner</h2>
                <p className="text-body-lg text-on-surface-variant max-w-2xl">
                  Continue your planning work or start a new analysis. Objectives, scenarios,
                  evidence, and human decisions persist across sessions.
                </p>
              </div>
            </div>

            {!loading && continueProjects.length > 0 && (
              <section className="mb-10">
                <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-4">
                  Continue
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {continueProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => router.push(`/workspace/${p.id}`)}
                      className="min-w-[260px] text-left border border-outline-variant bg-surface-container-lowest p-5 hover:border-primary transition-colors shrink-0"
                    >
                      <h4 className="text-headline-md text-on-surface mb-1">{p.name}</h4>
                      <p className="text-caption text-on-surface-variant mb-3">{p.geographyLabel}</p>
                      {p.resumeNote && (
                        <p className="text-body-sm text-primary bg-primary-fixed/20 border border-primary-fixed/40 px-3 py-2 rounded">
                          {p.resumeNote}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-4">
                All projects
              </h3>
              {loading ? (
                <p className="text-body-sm text-on-surface-variant">Loading projects…</p>
              ) : projects.length === 0 ? (
                <div className="border border-outline-variant bg-surface-container-lowest p-10 text-center">
                  <p className="text-headline-md text-on-surface mb-2">No projects yet</p>
                  <p className="text-body-sm text-on-surface-variant mb-6">
                    Create a workspace and describe your planning question in natural language.
                    Demo seed projects appear after first deploy when the data disk is empty.
                  </p>
                  <button
                    onClick={() => router.push("/new")}
                    className="bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium"
                  >
                    Create your first project
                  </button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => router.push(`/workspace/${p.id}`)}
                      className="text-left border border-outline-variant bg-surface-container-lowest p-5 hover:border-primary transition-colors"
                    >
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <h4 className="text-headline-md text-on-surface">{p.name}</h4>
                        <span className="font-mono text-data-label text-outline uppercase shrink-0">
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-caption text-on-surface-variant">{p.geographyLabel}</p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="w-full lg:w-80 shrink-0 space-y-6">
            {actionItems.length > 0 && (
              <section className="border border-secondary/40 bg-secondary-fixed/10 p-4">
                <h3 className="font-mono text-data-label uppercase text-secondary mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  Action required
                </h3>
                <ul className="space-y-3">
                  {actionItems.map((item) => (
                    <li key={item.projectId}>
                      <button
                        onClick={() => router.push(`/workspace/${item.projectId}`)}
                        className="text-left w-full text-body-sm hover:text-primary"
                      >
                        {item.kind === "ai" && (
                          <ProvenanceChip kind="copilot_recommendation" />
                        )}
                        {item.kind === "manual" && (
                          <ProvenanceChip kind="planner_decision" />
                        )}
                        <span className="block mt-1">{item.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="border border-outline-variant p-4 bg-surface-container-low">
              <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-3">
                WebMCP
              </h3>
              <p className="text-body-sm text-on-surface-variant mb-2">
                Browser tools register on every page via{" "}
                <code className="font-mono text-[11px]">document.modelContext.registerTool</code>.
              </p>
              <p className="text-caption text-on-surface-variant">
                Enable{" "}
                <code className="font-mono">chrome://flags/#enable-webmcp-testing</code> or use
                ChatGPT in-app browser. See README for eval commands.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
