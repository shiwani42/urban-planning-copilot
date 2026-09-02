"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "@/lib/domain/types";
import { fetchJsonWithRetry } from "@/lib/fetch-json";
import { onWorkspaceMutated } from "@/lib/workspace-sync";

export function useWorkspace(projectId: string) {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await fetchJsonWithRetry<WorkspaceSnapshot>(
      `/api/projects/${projectId}`,
      { cache: "no-store" },
      { label: "Load project" }
    );
    setWorkspace(data);
    setError(null);
    return data;
  }, [projectId]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setWorkspace(null);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    return onWorkspaceMutated((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      refresh().catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        // Keep the last loaded workspace — a transient refresh failure must not look like data loss.
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

  return { workspace, setWorkspace, loading, error, busy, refresh, act, clearError };
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
