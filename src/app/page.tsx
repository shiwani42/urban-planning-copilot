"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { StorageBanner } from "@/components/StorageBanner";
import { PlannerGreeting } from "@/components/PlannerGreeting";
import { ActionRequiredKindChip } from "@/components/workspace-hooks";
import { formatRelativeTime, formatLocaleTime, projectRecencyIso } from "@/lib/format";
import {
  analysisStatusPresentation,
  continueCardActivity,
  scenarioChipLabel,
} from "@/lib/home-dashboard";
import type { RecentActivityRow, RecentAnalysisRow } from "@/lib/domain/types";
import {
  getRecentProjectHints,
  type RecentProjectHint,
} from "@/lib/project-recency";
import { onWorkspaceMutated } from "@/lib/workspace-sync";
import { fetchJsonWithRetry } from "@/lib/fetch-json";
import { projectStatusLine, projectStatusTone } from "@/lib/project-status";
import {
  useStorageStatus,
  projectsPersistReliably,
  shouldShowStorageUnavailableBanner,
} from "@/lib/storage-status";

const DELETED_LAST_PROJECT_KEY = "upc-deleted-last-project";

type Project = {
  id: string;
  name: string;
  updatedAt: string;
  lastOpenedAt?: string;
  resumeNote?: string;
  geographyLabel: string;
  approvedScenarioName?: string;
  activeScenarioStatus?: string;
  activeScenarioNote?: string;
  actionRequiredLabel?: string;
  actionRequiredKind?: "manual" | "data" | "ai";
  shortlistCount?: number;
  scenarioCount?: number;
  scenarioSummary?: string;
  activeScenarioName?: string;
  activeScenarioId?: string;
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
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-section-padding px-section-padding">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="min-w-[240px] w-[240px] shrink-0 border border-outline-variant bg-surface-container-lowest p-4 animate-pulse"
          aria-hidden="true"
        >
          <div className="h-5 bg-surface-container rounded w-3/4 mb-2" />
          <div className="h-3 bg-surface-container rounded w-1/2 mb-3" />
          <div className="h-4 bg-surface-container rounded w-full" />
        </div>
      ))}
    </div>
  );
}

function projectStatusClass(tone: ReturnType<typeof projectStatusTone>): string {
  switch (tone) {
    case "ready":
      return "text-on-surface-variant";
    case "attention":
      return "text-secondary";
    default:
      return "text-on-surface-variant";
  }
}

export default function HomePage() {
  const router = useRouter();
  const allSectionRef = useRef<HTMLElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentAnalyses, setRecentAnalyses] = useState<RecentAnalysisRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivityRow[]>([]);
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
  const [deletedLastProject, setDeletedLastProject] = useState(false);
  const [listStorageIssue, setListStorageIssue] = useState<string | null>(null);
  const storageStatus = useStorageStatus();

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await fetchJsonWithRetry<{
        projects?: Project[];
        recentAnalyses?: RecentAnalysisRow[];
        recentActivity?: RecentActivityRow[];
        storage?: {
          status?: string;
          storeExists?: boolean;
          storeReadError?: string;
          message?: string;
        };
        error?: string;
      }>("/api/projects", { cache: "no-store" }, { label: "Load projects" });
      const storage = data.storage;
      if (
        storage?.status === "degraded" ||
        storage?.storeExists === false ||
        storage?.storeReadError
      ) {
        setListStorageIssue(
          storage.storeReadError ??
            storage.message ??
            "Workspace storage is unavailable — projects could not be loaded."
        );
      } else {
        setListStorageIssue(null);
      }
      setProjects(data.projects ?? []);
      setRecentAnalyses(data.recentAnalyses ?? []);
      setRecentActivity(data.recentActivity ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.includes("JSON") || message.includes("empty response")
          ? "Could not load projects — the server returned an incomplete response. Try again."
          : message
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    setRecentHints(getRecentProjectHints());
    try {
      setDeletedLastProject(sessionStorage.getItem(DELETED_LAST_PROJECT_KEY) === "1");
    } catch {
      /* ignore */
    }
    return onWorkspaceMutated(() => {
      loadProjects();
    });
  }, [loadProjects]);

  useEffect(() => {
    if (projects.length > 0) {
      setDeletedLastProject(false);
      try {
        sessionStorage.removeItem(DELETED_LAST_PROJECT_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [projects.length]);

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

  const continueProjectIds = useMemo(
    () => new Set(continueProjects.map((p) => p.id)),
    [continueProjects]
  );

  const allProjectsExcludingContinue = useMemo(() => {
    if (search.trim() || continueProjects.length === 0) return filteredProjects;
    return filteredProjects.filter((p) => !continueProjectIds.has(p.id));
  }, [filteredProjects, continueProjectIds, continueProjects.length, search]);

  const actionItems = useMemo(() => {
    const items: Array<{
      label: string;
      projectId: string;
      kind: "manual" | "data" | "ai";
    }> = [];
    for (const p of projects) {
      if (!p.actionRequiredLabel) continue;
      items.push({
        label: p.actionRequiredLabel,
        projectId: p.id,
        kind: p.actionRequiredKind ?? "manual",
      });
    }
    return items.slice(0, 3);
  }, [projects]);

  function openProject(id: string, scenarioId?: string) {
    const params = new URLSearchParams();
    if (scenarioId) params.set("scenarioId", scenarioId);
    const qs = params.toString();
    router.push(`/workspace/${id}${qs ? `?${qs}` : ""}`);
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
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== project.id);
        if (next.length === 0) {
          setDeletedLastProject(true);
          try {
            sessionStorage.setItem(DELETED_LAST_PROJECT_KEY, "1");
          } catch {
            /* ignore */
          }
        }
        return next;
      });
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
      <div className="relative shrink-0 flex items-center gap-1">
        <button
          type="button"
          aria-label={`Rename ${project.name}`}
          disabled={busyId === project.id}
          onClick={(e) => {
            e.stopPropagation();
            startRename(project);
          }}
          className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">edit</span>
        </button>
        <button
          type="button"
          aria-label={`Actions menu for ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={menuId === project.id}
          disabled={busyId === project.id}
          onClick={(e) => {
            e.stopPropagation();
            setMenuId((id) => (id === project.id ? null : project.id));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setMenuId((id) => (id === project.id ? null : project.id));
            }
          }}
          className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
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
                className="w-full text-left px-3 py-2 text-body-sm hover:bg-surface-container focus:bg-surface-container"
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
                className="w-full text-left px-3 py-2 text-body-sm text-error hover:bg-error-container/30 focus:bg-error-container/30"
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

  const storageHealthy = projectsPersistReliably(storageStatus);
  const showOrphanHints =
    !loading &&
    !error &&
    storageHealthy &&
    projects.length === 0 &&
    recentHints.length > 0 &&
    recoveryChecked &&
    recoverableIds.length === 0;

  function continueActivityStyles(kind: "ai" | "data" | "manual") {
    switch (kind) {
      case "ai":
        return {
          border: "border-primary/30",
          accent: "bg-primary-container",
          icon: "smart_toy",
          iconClass: "text-primary-container",
        };
      case "data":
        return {
          border: "border-outline-variant/60",
          accent: "bg-outline",
          icon: "database",
          iconClass: "text-outline",
        };
      default:
        return {
          border: "border-secondary/40",
          accent: "bg-secondary-container",
          icon: "person",
          iconClass: "text-secondary",
        };
    }
  }

  function renderContinueCard(project: Project) {
    const activity = continueCardActivity(project);
    const styles = continueActivityStyles(activity.kind);
    const subtitle =
      project.scenarioSummary ??
      project.geographyLabel ??
      project.activeScenarioStatus ??
      "Planning workspace";
    const chip = scenarioChipLabel(project.activeScenarioName);

    if (renamingId === project.id) {
      return (
        <div
          key={project.id}
          className="min-w-[280px] w-[280px] shrink-0 border border-outline-variant bg-surface-container-lowest p-4"
        >
          {renderProjectCard(project, "continue")}
        </div>
      );
    }

    return (
      <article
        key={project.id}
        className="min-w-[280px] w-[280px] shrink-0 group relative focus-within:ring-2 focus-within:ring-primary/40 rounded"
      >
        <button
          type="button"
          onClick={() => openProject(project.id, project.activeScenarioId)}
          disabled={busyId === project.id}
          className="w-full text-left border border-outline-variant bg-surface-container-lowest hover:border-primary/50 transition-colors overflow-hidden flex flex-col disabled:opacity-50 focus-ring rounded"
        >
          <div className="h-[120px] w-full bg-surface-container-low border-b border-outline-variant relative">
            <div
              className="absolute inset-0 opacity-90"
              style={{
                background:
                  "linear-gradient(135deg, #e8eef0 0%, #c1e8ff 45%, #f0eded 100%)",
              }}
              aria-hidden
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface/80 to-transparent" />
            <span className="absolute top-2 right-2 bg-surface border border-outline-variant px-2 py-0.5 rounded font-mono text-[10px] text-on-surface shadow-sm">
              {chip}
            </span>
            <span className="absolute bottom-2 left-2 font-mono text-[10px] text-on-surface-variant uppercase">
              {project.geographyLabel}
            </span>
          </div>
          <div className="p-4 flex-1 flex flex-col">
            <h4 className="text-headline-md text-on-surface mb-1">{project.name}</h4>
            <p className="text-caption text-on-surface-variant mb-3 line-clamp-2">{subtitle}</p>
            <div
              className={`mt-auto bg-surface-container p-3 rounded border ${styles.border} relative overflow-hidden`}
            >
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${styles.accent}`} />
              <div className="flex items-start gap-2 pl-1">
                <span
                  className={`material-symbols-outlined text-[16px] mt-0.5 ${styles.iconClass}`}
                >
                  {styles.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-caption text-on-surface-variant line-clamp-2">
                    {activity.text}
                  </p>
                  <p className="font-mono text-[10px] text-outline mt-1 uppercase">
                    {activity.when}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </button>
        <div className="absolute top-2 left-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
          {renderProjectActions(project)}
        </div>
      </article>
    );
  }

  function renderRecentAnalysesTable() {
    return (
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4 border-b border-outline-variant pb-2">
          <h2 className="text-headline-md text-on-surface">Recent Analyses</h2>
        </div>
        {recentAnalyses.length === 0 ? (
          <div className="border border-outline-variant bg-surface-container-lowest p-6 text-body-sm text-on-surface-variant">
            Run analysis in a workspace to see completed and in-progress runs here.
          </div>
        ) : (
          <div className="border border-outline-variant bg-surface-container-lowest overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant font-mono text-data-label text-on-surface-variant">
                  <th className="py-3 px-4 font-normal">Analysis name</th>
                  <th className="py-3 px-4 font-normal">Project</th>
                  <th className="py-3 px-4 font-normal">Status</th>
                  <th className="py-3 px-4 font-normal hidden sm:table-cell">Result</th>
                  <th className="py-3 px-4 font-normal text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="text-body-sm">
                {recentAnalyses.map((row) => {
                  const status = analysisStatusPresentation(row.status);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-outline-variant last:border-b-0 hover:bg-surface-container-low transition-colors"
                    >
                      <td className="py-3 px-4 text-on-surface font-medium">
                        <button
                          type="button"
                          onClick={() => openProject(row.projectId, row.scenarioId)}
                          className="text-left hover:text-primary inline-flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-[16px] text-outline">
                            analytics
                          </span>
                          {row.analysisName}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-on-surface-variant">{row.projectName}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[12px] font-medium ${status.className}`}
                        >
                          <span className={status.dotClassName} aria-hidden />
                          {status.label}
                        </span>
                      </td>
                      <td
                        className={`py-3 px-4 hidden sm:table-cell ${
                          row.status === "failed"
                            ? "text-error"
                            : row.status === "running"
                              ? "text-outline italic"
                              : "text-on-surface-variant"
                        }`}
                      >
                        {row.result}
                      </td>
                      <td className="py-3 px-4 text-on-surface-variant text-right font-mono text-[11px]">
                        {formatLocaleTime(row.timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  function renderProjectCard(project: Project, variant: "continue" | "all") {
    const isRenaming = renamingId === project.id;
    const statusLine = projectStatusLine(project);
    const statusTone = projectStatusTone(project);
    const cardClass =
      variant === "continue"
        ? "min-w-[240px] w-[240px] shrink-0 text-left border border-outline-variant bg-surface-container-lowest p-4 hover:border-primary/60 transition-colors"
        : "text-left border border-outline-variant bg-surface-container-lowest px-4 py-3 hover:border-primary/60 transition-colors";

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
      <article
        key={project.id}
        className="group relative focus-within:ring-2 focus-within:ring-primary/40 rounded"
      >
        <button
          type="button"
          onClick={() => openProject(project.id, project.activeScenarioId)}
          disabled={busyId === project.id}
          className={`${cardClass} w-full disabled:opacity-50 focus-ring`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openProject(project.id, project.activeScenarioId);
            }
          }}
        >
          <div className="flex justify-between items-start gap-3 mb-1">
            <h4
              className={`${variant === "continue" ? "text-headline-md" : "text-body-sm font-medium"} text-on-surface text-left`}
            >
              {project.name}
            </h4>
            <span className="font-mono text-[10px] text-outline uppercase shrink-0 text-right leading-tight">
              {renderRecency(project)}
            </span>
          </div>
          <p className="text-caption text-on-surface-variant text-left mb-2">
            {project.geographyLabel}
          </p>
          <p
            className={`text-body-sm text-left leading-snug ${projectStatusClass(statusTone)}`}
            title={statusLine}
          >
            {statusLine}
          </p>
        </button>
        <div className="absolute top-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
          {renderProjectActions(project)}
        </div>
      </article>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" onClick={() => setMenuId(null)}>
      <AppHeader active="projects" />
      <StorageBanner />
      {storageStatus.lastBoot === "empty-after-missing-file" &&
        !shouldShowStorageUnavailableBanner(storageStatus) && (
        <div
          role="status"
          className="bg-error-container/40 border-b border-error px-section-padding py-3 text-body-sm text-error"
        >
          Workspace catalog may have reset after a deploy — the server booted without finding
          durable storage. Reload projects; if studies are missing, create a new workspace or
          restore from backup.
        </div>
      )}

      <main id="main-content" className="flex-1 max-w-7xl w-full mx-auto px-section-padding py-10">
        <div className="flex flex-col lg:flex-row lg:items-start gap-10">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div className="flex-1 min-w-0">
                <PlannerGreeting className="text-display text-on-surface mb-2" />
                <p className="text-body-sm text-on-surface-variant max-w-2xl">
                  Continue your planning work or start a new analysis.
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
                  className="w-full pl-10 pr-3 py-2 border border-outline-variant bg-surface-container-lowest text-body-sm focus-ring focus:border-primary"
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
                      <h3 className="font-mono text-data-label uppercase text-on-surface-variant flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px]">schedule</span>
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
                    <div className="flex gap-3 overflow-x-auto pb-2 -mx-section-padding px-section-padding scroll-px-section-padding">
                      {continueProjects.map((p) => renderContinueCard(p))}
                    </div>
                  </section>
                )}

                {!loading && !error && renderRecentAnalysesTable()}

                {(allProjectsExcludingContinue.length > 0 || search.trim()) && (
                <section ref={allSectionRef} id="all-projects">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h3 className="font-mono text-data-label uppercase text-on-surface-variant">
                      {continueProjects.length > 0 && !search.trim()
                        ? "All other projects"
                        : "All projects"}
                    </h3>
                    {search.trim() && (
                      <p className="text-caption text-on-surface-variant">
                        {filteredProjects.length} of {sortedProjects.length} shown
                      </p>
                    )}
                  </div>
                  {sortedProjects.length === 0 ? (
                    <div className="border border-outline-variant bg-surface-container-lowest p-10 text-center">
                      {listStorageIssue ? (
                        <>
                          <p className="text-headline-md text-on-surface mb-2">
                            Could not load projects
                          </p>
                          <p className="text-body-sm text-on-surface-variant mb-6 max-w-lg mx-auto">
                            {listStorageIssue} This is a storage issue — not an empty project list.
                            Check workspace storage configuration or try again.
                          </p>
                          <button
                            type="button"
                            onClick={() => void loadProjects()}
                            className="inline-block bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium"
                          >
                            Retry
                          </button>
                        </>
                      ) : deletedLastProject ? (
                        <>
                          <p className="text-headline-md text-on-surface mb-2">
                            You deleted the last project
                          </p>
                          <p className="text-body-sm text-on-surface-variant mb-6 max-w-lg mx-auto">
                            Your project list is empty because you removed the final workspace.
                            Create a new project whenever you are ready — nothing else was lost on
                            the server from that delete.
                          </p>
                          <Link
                            href="/new"
                            className="inline-block bg-primary text-on-primary px-5 py-2.5 rounded text-body-sm font-medium"
                          >
                            Create a new project
                          </Link>
                        </>
                      ) : showOrphanHints ? (
                        <>
                          <p className="text-headline-md text-on-surface mb-2">
                            Browser history does not match the server catalog
                          </p>
                          <p className="text-body-sm text-on-surface-variant mb-4 max-w-lg mx-auto">
                            This browser recently opened{" "}
                            {recentHints
                              .slice(0, 3)
                              .map((h) => h.name)
                              .join(", ")}
                            , but the server project list is empty while workspace storage is
                            healthy. That usually means those workspaces were never saved, were
                            created in another environment, or were reset. Your prior work may be
                            unrecoverable from this session.
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
                            language.
                            {storageHealthy
                              ? " Projects are saved on the server and persist across sessions."
                              : " On this server, projects may not survive restarts until DATABASE_URL is configured — check the storage banner above."}
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
                  ) : allProjectsExcludingContinue.length === 0 ? (
                    <p className="text-body-sm text-on-surface-variant py-4">
                      Every project is in Continue — scroll up or search to filter.
                    </p>
                  ) : (
                    <div className="divide-y divide-outline-variant border border-outline-variant bg-surface-container-lowest">
                      {allProjectsExcludingContinue.map((p) => renderProjectCard(p, "all"))}
                    </div>
                  )}
                </section>
                )}
              </>
            )}
          </div>

          <aside className="w-full lg:w-80 shrink-0 space-y-6">
            <section className="border border-outline-variant bg-surface-container-lowest p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-secondary-container to-primary-container" />
              <h3 className="text-headline-md text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">priority_high</span>
                Action required
              </h3>
              {actionItems.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">
                  No pending reviews — open a project to run analysis or record decisions.
                </p>
              ) : (
                <ul className="space-y-3">
                  {actionItems.map((item) => (
                    <li key={item.projectId}>
                      <button
                        type="button"
                        onClick={() => router.push(`/workspace/${item.projectId}`)}
                        className="w-full text-left border border-outline-variant hover:border-primary/40 bg-surface-container-low p-3 rounded transition-colors"
                      >
                        <div className="flex gap-3">
                          <span className="material-symbols-outlined text-[20px] shrink-0 text-on-surface-variant">
                            {item.kind === "ai"
                              ? "smart_toy"
                              : item.kind === "data"
                                ? "warning"
                                : "how_to_reg"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-body-sm font-medium text-on-surface">
                              {item.label}
                            </p>
                            <div className="mt-2">
                              <ActionRequiredKindChip kind={item.kind} />
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {recentActivity.length > 0 && (
              <section className="border border-outline-variant bg-surface-container-lowest p-5">
                <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-4">
                  Recent system activity
                </h3>
                <ul className="space-y-3">
                  {recentActivity.map((event) => (
                    <li key={event.id} className="flex gap-3 text-body-sm">
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          event.actor === "agent" ? "bg-primary-container" : "border border-outline"
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-on-surface-variant leading-snug">{event.summary}</p>
                        <p className="font-mono text-[10px] text-outline mt-1">
                          {formatLocaleTime(event.timestamp)}
                        </p>
                      </div>
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
