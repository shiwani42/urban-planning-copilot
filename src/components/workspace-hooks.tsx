"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "@/lib/domain/types";
import { onWorkspaceMutated } from "@/lib/workspace-sync";

export function useWorkspace(projectId: string) {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message =
        typeof data.error === "string" ? data.error : "Project not found";
      throw new Error(message);
    }
    const data = await res.json();
    setWorkspace(data);
    return data as WorkspaceSnapshot;
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    return onWorkspaceMutated((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      refresh().catch((e) => setError(e.message));
    });
  }, [projectId, refresh]);

  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...body }),
        });
        const data = await res.json();
        if (!res.ok) {
          const message =
            typeof data.error === "string" && data.error.length > 0
              ? data.error
              : "Action failed";
          throw new Error(message);
        }
        await refresh();
        return data;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [projectId, refresh]
  );

  return { workspace, setWorkspace, loading, error, busy, refresh, act };
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
