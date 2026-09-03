"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@/lib/domain/types";
import { WORKSPACE_LOAD_PHASES, workspaceLoadPhaseLabel } from "@/lib/planner-copy";
import { fetchJsonWithServerWake } from "@/lib/server-wake";
import { onWorkspaceMutated } from "@/lib/workspace-sync";

const LOAD_TIMEOUT_MS = 25_000;

export { workspaceLoadPhaseLabel } from "@/lib/planner-copy";

function isNotFoundError(message: string): boolean {
  return /not found/i.test(message);
}

export type WorkspaceLoadState = {
  workspace: WorkspaceSnapshot | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  loadPhase: string;
  elapsedMs: number;
  isRetrying: boolean;
  refreshing: boolean;
  projectNotFound: boolean;
  lastFetchAt: string | null;
  refresh: () => Promise<WorkspaceSnapshot | null>;
  act: (action: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  clearError: () => void;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceSnapshot | null>>;
};

export function useWorkspace(projectId: string): WorkspaceLoadState {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadPhase, setLoadPhase] = useState<string>(WORKSPACE_LOAD_PHASES[0].label);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [projectNotFound, setProjectNotFound] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  const loadAttemptRef = useRef(0);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const handleFetchFailure = useCallback((message: string) => {
    setLastFetchAt(new Date().toISOString());
    if (isNotFoundError(message)) {
      setProjectNotFound(true);
      setWorkspace(null);
      workspaceRef.current = null;
    }
    setError(message);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setProjectNotFound(false);
    try {
      const data = await fetchJsonWithServerWake<WorkspaceSnapshot>(
        `/api/projects/${projectId}`,
        { cache: "no-store" },
        { label: "Load project", retries: 3 }
      );
      setWorkspace(data);
      workspaceRef.current = data;
      setError(null);
      setProjectNotFound(false);
      setLastFetchAt(new Date().toISOString());
      return data;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      handleFetchFailure(message);
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [projectId, handleFetchFailure]);

  const clearError = useCallback(() => setError(null), []);

  const loadWorkspace = useCallback(async () => {
    const attempt = ++loadAttemptRef.current;
    setLoading(true);
    setError(null);
    setIsRetrying(false);
    setProjectNotFound(false);
    setElapsedMs(0);
    setLoadPhase(WORKSPACE_LOAD_PHASES[0].label);

    const started = Date.now();
    const tick = window.setInterval(() => {
      if (loadAttemptRef.current !== attempt) return;
      const elapsed = Date.now() - started;
      setElapsedMs(elapsed);
      setLoadPhase(workspaceLoadPhaseLabel(elapsed));
      if (elapsed >= 6000) setIsRetrying(true);
    }, 500);

    const timeout = window.setTimeout(() => {
      if (loadAttemptRef.current !== attempt) return;
      setError(
        "Loading timed out — the server may be waking up. Retry, or return to Projects and open again."
      );
      setLoading(false);
    }, LOAD_TIMEOUT_MS);

    try {
      const data = await refresh();
      if (!data && loadAttemptRef.current === attempt) {
        setWorkspace(null);
      }
    } catch (e) {
      if (loadAttemptRef.current !== attempt) return;
      const message = e instanceof Error ? e.message : String(e);
      handleFetchFailure(message);
      if (!workspaceRef.current) {
        setWorkspace(null);
      }
    } finally {
      if (loadAttemptRef.current === attempt) {
        window.clearInterval(tick);
        window.clearTimeout(timeout);
        setLoading(false);
        setIsRetrying(false);
      }
    }
  }, [refresh, handleFetchFailure]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    return onWorkspaceMutated((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      refresh().catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        handleFetchFailure(message);
      });
    });
  }, [projectId, refresh, handleFetchFailure]);

  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        const data = await fetchJsonWithServerWake<Record<string, unknown>>(
          `/api/projects/${projectId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...body }),
          },
          { label: "Workspace action" }
        );
        try {
          await refresh();
        } catch (refreshErr) {
          const message =
            refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          handleFetchFailure(message);
        }
        return data;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/scenario not found/i.test(message)) {
          try {
            await refresh();
            setError(null);
          } catch {
            handleFetchFailure(message);
          }
        } else {
          handleFetchFailure(message);
        }
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [projectId, refresh, handleFetchFailure]
  );

  return {
    workspace,
    setWorkspace,
    loading,
    error,
    busy,
    loadPhase,
    elapsedMs,
    isRetrying,
    refreshing,
    projectNotFound,
    lastFetchAt,
    refresh,
    act,
    clearError,
  };
}

export function ProvenanceChip({
  kind,
}: {
  kind: "source_data" | "calculated" | "copilot_recommendation" | "planner_decision";
}) {
  const map = {
    source_data: {
      label: "Observed",
      className: "border border-outline-variant text-on-surface-variant bg-transparent rounded",
    },
    calculated: {
      label: "Calculated",
      className: "border border-outline-variant/60 bg-surface-container text-on-surface-variant rounded",
    },
    copilot_recommendation: {
      label: "AI REC",
      className: "bg-primary-container text-on-primary rounded",
    },
    planner_decision: {
      label: "MANUAL",
      className: "bg-secondary-container text-on-secondary-container rounded",
    },
  } as const;
  const m = map[kind];
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${m.className}`}
      aria-label={m.label}
    >
      {m.label}
    </span>
  );
}

/** Home Action Required row — maps project action kind to provenance chip + icon. */
export function ActionRequiredKindChip({
  kind,
}: {
  kind: "manual" | "data" | "ai";
}) {
  if (kind === "ai") return <ProvenanceChip kind="copilot_recommendation" />;
  if (kind === "data") {
    return (
      <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-outline-variant text-on-surface-variant bg-transparent rounded">
        Data
      </span>
    );
  }
  return <ProvenanceChip kind="planner_decision" />;
}
