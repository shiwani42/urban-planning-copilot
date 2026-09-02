"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { StorageBanner } from "@/components/StorageBanner";
import { PlannerGreeting } from "@/components/PlannerGreeting";
import { ProvenanceChip } from "@/components/workspace-hooks";
import { formatRelativeTime, projectRecencyIso } from "@/lib/format";
import {
  getRecentProjectHints,
  type RecentProjectHint,
} from "@/lib/project-recency";
import { onWorkspaceMutated } from "@/lib/workspace-sync";

type Project = {
  id: string;
  name: string;
  updatedAt: string;
  lastOpenedAt?: string;
  resumeNote?: string;
  geographyLabel: string;
};

const SHOW_WEBMCP_UI = process.env.NEXT_PUBLIC_SHOW_WEBMCP_UI === "true";
const CONTINUE_LIMIT = 3;

function sortByRecency(a: Project, b: Project): number {
  return projectRecencyIso(b).localeCompare(projectRecencyIso(a));
}

function matchesSearch(project: Project, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    project.name.toLowerCase().includes(q) ||
    project.geographyLabel.toLowerCase().includes(q) ||
    (project.resumeNote?.toLowerCase().includes(q) ?? false)
  );
}

function ProjectSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid md:grid-cols-2 gap-4" aria-hidden="true">
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="border border-outline-variant bg-surface-container-lowest p-5 animate-pulse"
        >
          <div className="h-5 bg-surface-container rounded w-2/3 mb-3" />
          <div className="h-3 bg-surface-container rounded w-1/2 mb-2" />
          <div className="h-3 bg-surface-container rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}

function ContinueSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-section-padding px-section-padding">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="min-w-[260px] w-[260px] shrink-0 border border-outline-variant bg-surface-container-lowest p-5 animate-pulse"
          aria-hidden="true"
        >
          <div className="h-5 bg-surface-container rounded w-3/4 mb-3" />
          <div className="h-3 bg-surface-container rounded w-1/2 mb-4" />
          <div className="h-10 bg-surface-container rounded" />
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const allSectionRef = useRef<HTMLElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [recentHints, setRecentHints] = useState<RecentProjectHint[]>([]);
  const [recoverableIds, setRecoverableIds] = useState<string[]>([]);
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load projects");
      setProjects(data.projects ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    setRecentHints(getRecentProjectHints());
    return onWorkspaceMutated(() => {
      loadProjects();
    });
  }, [loadProjects]);

  useEffect(() => {
    if (loading || projects.length > 0) {
      setRecoveryChecked(true);
      setRecoverableIds([]);
      return;
    }
    const hints = getRecentProjectHints();
    setRecentHints(hints);
    if (hints.length === 0) {
      setRecoveryChecked(true);
      setRecoverableIds([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const found: string[] = [];
      for (const hint of hints.slice(0, 5)) {
        try {
          const res = await fetch(`/api/projects/${hint.id}`, { cache: "no-store" });
          if (res.ok) found.push(hint.id);
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) {
        setRecoverableIds(found);
        setRecoveryChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, projects.length]);

  const sortedProjects = useMemo(
    () => projects.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects]
  );

  const filteredProjects = useMemo(
    () => sortedProjects.filter((p) => matchesSearch(p, search)),
    [sortedProjects, search]
  );

  const continueProjects = useMemo(
    () => sortedProjects.slice().sort(sortByRecency).slice(0, CONTINUE_LIMIT),
    [sortedProjects]
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

  function openProject(id: string) {
    router.push(`/workspace/${id}`);
  }

  async function deleteProject(project: Project) {
    const ok = window.confirm(
      `Delete "${project.name}"?\n\nThis permanently removes the project, scenarios, analyses, and reports. This cannot be undone.`
    );
    if (!ok) return;
    setBusyId(project.id);
    setMenuId(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete project");
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function startRename(project: Project) {
    setRenamingId(project.id);
    setRenameDraft(project.name);
    setRenameError(null);
    setMenuId(null);
  }

  async function submitRename(projectId: string) {
    const trimmed = renameDraft.trim();
    if (trimmed.length < 2) {
      setRenameError("Project name must be at least 2 characters.");
      return;
    }
    const duplicate = projects.some(
      (p) => p.id !== projectId && p.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      setRenameError(`A project named "${trimmed}" already exists.`);
      return;
    }
    setBusyId(projectId);
    setRenameError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename_project", name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to rename project");
      setProjects((prev) =>
        prev
          .map((p) => (p.id === projectId ? { ...p, ...data.project } : p))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      );
      setRenamingId(null);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function renderRecency(project: Project) {
    const iso = projectRecencyIso(project);
    const prefix = project.lastOpenedAt ? "Opened" : "Updated";
    return `${prefix} ${formatRelativeTime(iso)}`;
  }

  function renderProjectActions(project: Project) {
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label={`Actions for ${project.name}`}
          aria-expanded={menuId === project.id}
          disabled={busyId === project.id}
          onClick={(e) => {
            e.stopPropagation();
            setMenuId((id) => (id === project.id ? null : project.id));
          }}
          className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">more_vert</span>
        </button>
        {menuId === project.id && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-10 cursor-default"
              onClick={(e) => {
                e.stopPropagation();
                setMenuId(null);
              }}
            />
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 z-20 min-w-[140px] border border-outline-variant bg-surface-container-lowest shadow-sm"
            >
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-3 py-2 text-body-sm hover:bg-surface-container"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(project);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-3 py-2 text-body-sm text-error hover:bg-error-container/30"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteProject(project);
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderProjectCard(project: Project, variant: "continue" | "all") {
    const isRenaming = renamingId === project.id;
    const cardClass =
      variant === "continue"
        ? "min-w-[260px] w-[260px] shrink-0 text-left border border-outline-variant bg-surface-container-lowest p-5 hover:border-primary transition-colors"
        : "text-left border border-outline-variant bg-surface-container-lowest p-5 hover:border-primary transition-colors";

    if (isRenaming) {
      return (
        <div key={project.id} className={cardClass} onClick={(e) => e.stopPropagation()}>
          <label className="font-mono text-data-label uppercase text-on-surface-variant block mb-2">
            Rename project
          </label>
          <input
            value={renameDraft}
            onChange={(e) => {
              setRenameDraft(e.target.value);
              setRenameError(null);
            }}
            aria-invalid={Boolean(renameError)}
            className={`w-full border-b bg-transparent py-1 text-body-sm focus:outline-none mb-2 ${
              renameError ? "border-error" : "border-outline focus:border-primary"
            }`}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename(project.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
          />
          {renameError && (
            <p role="alert" className="text-caption text-error mb-2">
              {renameError}
            </p>
          )}
          {!renameError &&
            projects.some(
              (p) =>
                p.id !== project.id &&
                p.name.trim().toLowerCase() === renameDraft.trim().toLowerCase() &&
                renameDraft.trim().length >= 2
            ) && (
              <p role="status" className="text-caption text-secondary mb-2">
                Another project already uses this name.
              </p>
            )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyId === project.id}
              onClick={() => void submitRename(project.id)}
              className="bg-primary text-on-primary px-3 py-1 rounded text-caption disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setRenamingId(null)}
              className="border border-outline-variant px-3 py-1 rounded text-caption"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={project.id} className={`group relative ${variant === "all" ? "" : ""}`}>
        <button
          type="button"
          onClick={() => openProject(project.id)}
          disabled={busyId === project.id}
          className={`${cardClass} w-full disabled:opacity-50`}
        >
          <div className="flex justify-between items-start gap-3 mb-2">
            <h4 className="text-headline-md text-on-surface text-left">{project.name}</h4>
            {variant === "all" && (
              <span className="font-mono text-data-label text-outline uppercase shrink-0 hidden sm:inline">
                {renderRecency(project)}
              </span>
            )}
          </div>
          <p className="text-caption text-on-surface-variant text-left mb-2">
            {project.geographyLabel}
          </p>
          {variant === "continue" && (
            <p className="font-mono text-[10px] text-outline uppercase text-left mb-3">
              {renderRecency(project)}
            </p>
          )}
          {project.resumeNote && (
            <p className="text-body-sm text-primary bg-primary-fixed/20 border border-primary-fixed/40 px-3 py-2 rounded text-left">
              {project.resumeNote}
            </p>
          )}
        </button>
        <div className="absolute top-3 right-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
          {renderProjectActions(project)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" onClick={() => setMenuId(null)}>
      <AppHeader active="projects" />
      <StorageBanner />

      <main className="flex-1 max-w-7xl w-full mx-auto px-section-padding py-10">
        <div className="flex flex-col lg:flex-row lg:items-start gap-10">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
              <div className="flex-1 min-w-0">
                <PlannerGreeting className="text-display text-on-surface mb-2" />
                <p className="text-body-lg text-on-surface-variant max-w-2xl">
                  Continue your planning work or start a new analysis. Objectives, scenarios,
                  evidence, and human decisions persist across sessions.
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
                  placeholder="Search projects…"
                  aria-label="Search projects"
                  className="w-full pl-10 pr-3 py-2 border border-outline-variant bg-surface-container-lowest text-body-sm focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="border border-error/40 bg-error-container/20 p-6 mb-10 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1">
                  <p className="text-headline-md text-on-surface mb-1">Could not load projects</p>
                  <p className="text-body-sm text-on-surface-variant">{error}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadProjects()}
                  className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium shrink-0"
                >
                  Retry
                </button>
              </div>
            ) : loading ? (
              <>
                <section className="mb-10">
                  <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-4">
                    Continue
                  </h3>
                  <ContinueSkeleton />
                </section>
                <section>
                  <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-4">
                    All projects
                  </h3>
                  <ProjectSkeleton />
                </section>
              </>
            ) : (
              <>
                {continueProjects.length > 0 && !search.trim() && (
                  <section className="mb-10">
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <h3 className="font-mono text-data-label uppercase text-on-surface-variant">
                        Continue
                      </h3>
                      {sortedProjects.length > CONTINUE_LIMIT && (
                        <button
                          type="button"
                          onClick={() =>
                            allSectionRef.current?.scrollIntoView({ behavior: "smooth" })
                          }
                          className="font-mono text-data-label text-primary hover:underline uppercase"
                        >
                          View all projects
                        </button>
                      )}
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-4 -mx-section-padding px-section-padding scroll-px-section-padding">
                      {continueProjects.map((p) => renderProjectCard(p, "continue"))}
                    </div>
                  </section>
                )}

                <section ref={allSectionRef} id="all-projects">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h3 className="font-mono text-data-label uppercase text-on-surface-variant">
                      All projects
                    </h3>
                    {search.trim() && (
                      <p className="text-caption text-on-surface-variant">
                        {filteredProjects.length} of {sortedProjects.length} shown
                      </p>
                    )}
                  </div>
                  {sortedProjects.length === 0 ? (
                    <div className="border border-outline-variant bg-surface-container-lowest p-10 text-center">
                      {recentHints.length > 0 && recoveryChecked && recoverableIds.length === 0 ? (
                        <>
                          <p className="text-headline-md text-on-surface mb-2">
                            Projects not found on server
                          </p>
                          <p className="text-body-sm text-on-surface-variant mb-4 max-w-lg mx-auto">
                            This browser recently opened{" "}
                            {recentHints
                              .slice(0, 3)
                              .map((h) => h.name)
                              .join(", ")}
                            , but the server store no longer has them. That can happen after a
                            deploy without a persistent disk, a store reset, or switching
                            environments. Your prior work may be unrecoverable from this session.
                          </p>
                          <div className="flex flex-wrap justify-center gap-3">
                            <button
                              type="button"
                              onClick={() => void loadProjects()}
                              className="border border-outline-variant px-5 py-2.5 rounded text-body-sm"
                            >
                              Reload projects
                            </button>
                            <Link
                              href="/new"
                              className="inline-block bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium"
                            >
                              Start new project
                            </Link>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-headline-md text-on-surface mb-2">No projects yet</p>
                          <p className="text-body-sm text-on-surface-variant mb-6">
                            Create a workspace and describe your planning question in natural
                            language. Projects are saved on the server and persist across sessions
                            when the Render data disk is attached.
                          </p>
                          <Link
                            href="/new"
                            className="inline-block bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium"
                          >
                            Create your first project
                          </Link>
                        </>
                      )}
                      {recoverableIds.length > 0 && (
                        <div className="mt-8 text-left border-t border-outline-variant pt-6">
                          <p className="font-mono text-data-label uppercase text-on-surface-variant mb-3">
                            Recovered from server
                          </p>
                          <ul className="space-y-2">
                            {recentHints
                              .filter((h) => recoverableIds.includes(h.id))
                              .map((h) => (
                                <li key={h.id}>
                                  <button
                                    type="button"
                                    onClick={() => openProject(h.id)}
                                    className="text-body-sm text-primary hover:underline"
                                  >
                                    Open {h.name}
                                  </button>
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : filteredProjects.length === 0 ? (
                    <div className="border border-outline-variant bg-surface-container-lowest p-8 text-center">
                      <p className="text-body-sm text-on-surface-variant mb-2">
                        No projects match &ldquo;{search.trim()}&rdquo;.
                      </p>
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        className="text-body-sm text-primary hover:underline"
                      >
                        Clear search
                      </button>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                      {filteredProjects.map((p) => renderProjectCard(p, "all"))}
                    </div>
                  )}
                </section>
              </>
            )}
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

            {SHOW_WEBMCP_UI && (
              <section className="border border-outline-variant p-4 bg-surface-container-low">
                <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-3">
                  WebMCP (developer)
                </h3>
                <p className="text-body-sm text-on-surface-variant mb-2">
                  Browser tools register on every page via{" "}
                  <code className="font-mono text-[11px]">document.modelContext.registerTool</code>.
                </p>
                <p className="text-caption text-on-surface-variant">
                  Enable{" "}
                  <code className="font-mono">chrome://flags/#enable-webmcp-testing</code> or set{" "}
                  <code className="font-mono">NEXT_PUBLIC_SHOW_WEBMCP_UI=true</code>.
                </p>
              </section>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
