"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Project = {
  id: string;
  name: string;
  updatedAt: string;
  resumeNote?: string;
  geographyLabel: string;
};

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
          New project
        </button>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-section-padding py-10">
        <div className="mb-8">
          <h2 className="text-display text-on-surface mb-2">Projects</h2>
          <p className="text-body-lg text-on-surface-variant max-w-2xl">
            Continue a planning workspace or start a new investigation. Projects persist
            objectives, scenarios, analysis results, and human decisions.
          </p>
        </div>

        {loading ? (
          <p className="text-body-sm text-on-surface-variant">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="border border-outline-variant bg-surface-container-lowest p-10 text-center">
            <p className="text-headline-md text-on-surface mb-2">No projects yet</p>
            <p className="text-body-sm text-on-surface-variant mb-6">
              Create a workspace and describe your planning question in natural language.
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
                  <h3 className="text-headline-md text-on-surface">{p.name}</h3>
                  <span className="font-mono text-data-label text-outline uppercase">
                    {new Date(p.updatedAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-caption text-on-surface-variant mb-3">{p.geographyLabel}</p>
                {p.resumeNote && (
                  <p className="text-body-sm text-primary-container bg-primary-fixed/30 border border-primary-fixed px-3 py-2 rounded">
                    Resume: {p.resumeNote}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
