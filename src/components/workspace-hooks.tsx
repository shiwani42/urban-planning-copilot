"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@/lib/domain/types";
import { fetchJsonWithRetry } from "@/lib/fetch-json";
import { onWorkspaceMutated } from "@/lib/workspace-sync";

const LOAD_TIMEOUT_MS = 25_000;
const LOAD_PHASES = [
  { afterMs: 0, label: "Connecting to project storage…" },
  { afterMs: 2500, label: "Loading scenarios and analysis state…" },
  { afterMs: 6000, label: "Still loading — the server may be waking from sleep…" },
  { afterMs: 12_000, label: "Taking longer than usual — retrying…" },
] as const;

function phaseLabel(elapsedMs: number): string {
  let label: string = LOAD_PHASES[0].label;
  for (const phase of LOAD_PHASES) {
    if (elapsedMs >= phase.afterMs) label = phase.label;
  }
  return label;
}

export type WorkspaceLoadState = {
  workspace: WorkspaceSnapshot | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  loadPhase: string;
  elapsedMs: number;
  isRetrying: boolean;
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
  const [loadPhase, setLoadPhase] = useState<string>(LOAD_PHASES[0].label);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  const loadAttemptRef = useRef(0);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const refresh = useCallback(async () => {
    const { data } = await fetchJsonWithRetry<WorkspaceSnapshot>(
      `/api/projects/${projectId}`,
      { cache: "no-store" },
      { label: "Load project", retries: 3 }
    );
    setWorkspace(data);
    workspaceRef.current = data;
    setError(null);
    return data;
  }, [projectId]);

  const clearError = useCallback(() => setError(null), []);

  const loadWorkspace = useCallback(async () => {
    const attempt = ++loadAttemptRef.current;
    setLoading(true);
    setError(null);
    setIsRetrying(false);
    setElapsedMs(0);
    setLoadPhase(LOAD_PHASES[0].label);

    const started = Date.now();
    const tick = window.setInterval(() => {
      if (loadAttemptRef.current !== attempt) return;
      const elapsed = Date.now() - started;
      setElapsedMs(elapsed);
      setLoadPhase(phaseLabel(elapsed));
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
      await refresh();
    } catch (e) {
      if (loadAttemptRef.current !== attempt) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
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
  }, [refresh]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    return onWorkspaceMutated((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      refresh().catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
      });
    });
  }, [projectId, refresh]);

  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        const { data } = await fetchJsonWithRetry<Record<string, unknown>>(
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
          setError(message);
        }
        return data;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/scenario not found/i.test(message)) {
          try {
            await refresh();
            setError(null);
          } catch {
            setError(message);
          }
        } else {
          setError(message);
        }
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [projectId, refresh]
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
      label: "Source data",
      className: "border border-outline text-on-surface-variant bg-transparent",
    },
    calculated: {
      label: "Calculated",
      className: "bg-surface-container-high text-on-surface",
    },
    copilot_recommendation: {
      label: "AI recommendation",
      className: "bg-primary-container text-on-primary",
    },
    planner_decision: {
      label: "Planner decision",
      className: "bg-secondary text-on-secondary",
    },
  } as const;
  const m = map[kind];
  return (
    <span className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${m.className}`}>
      {m.label}
    </span>
  );
}
