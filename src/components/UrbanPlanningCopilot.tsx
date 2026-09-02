"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PLANNING_TOOL_META } from "@/lib/webmcp/tool-definitions";
import { invokePlanningTool } from "@/lib/webmcp/register-browser";
import {
  appendCopilotActivity,
  listCopilotActivity,
  onCopilotActivity,
  updateCopilotActivity,
  type CopilotActivityEntry,
} from "@/lib/copilot/copilot-activity";
import {
  plannerSuggestions,
  routePlannerQuery,
  summarizeToolResult,
  type PlannerSuggestion,
} from "@/lib/copilot/planner-query";
import {
  buildCopilotToolGroups,
  groupIdForTool,
  toolLabel,
} from "@/lib/copilot/tool-groups";
import { formatLocaleTime } from "@/lib/format";

type UrbanPlanningCopilotProps = {
  projectId?: string | null;
  scenarioId?: string | null;
  variant?: "sidebar" | "home";
  showActivityFeed?: boolean;
  onToolComplete?: () => void;
  className?: string;
};

function toolDescription(name: string): string {
  return PLANNING_TOOL_META.find((t) => t.name === name)?.description ?? name;
}

export function UrbanPlanningCopilot({
  projectId,
  scenarioId,
  variant = "sidebar",
  showActivityFeed = true,
  onToolComplete,
  className = "",
}: UrbanPlanningCopilotProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [activity, setActivity] = useState<CopilotActivityEntry[]>(() =>
    typeof window !== "undefined" ? listCopilotActivity() : []
  );

  const hasProject = Boolean(projectId);
  const suggestions = useMemo(() => plannerSuggestions(hasProject), [hasProject]);
  const toolGroups = useMemo(
    () => buildCopilotToolGroups({ includeProjects: !hasProject }),
    [hasProject]
  );

  useEffect(() => onCopilotActivity((detail) => setActivity(detail.entries)), []);

  const runTool = useCallback(
    async (tool: string, args: Record<string, unknown> = {}, userQuery?: string) => {
      if (tool === "__navigate__") {
        const href = typeof args.href === "string" ? args.href : "/";
        router.push(href);
        appendCopilotActivity({
          tool: "navigate",
          query: userQuery,
          status: "success",
          summary: `Opened ${href === "/explore" ? "Explore" : "New project"}.`,
        });
        return;
      }

      const entry = appendCopilotActivity({
        tool,
        query: userQuery,
        status: "running",
        summary: `Running ${toolLabel(tool)}…`,
      });
      setBusy(true);
      setError(null);
      try {
        const mergedArgs = {
          ...args,
          ...(projectId && !args.projectId ? { projectId } : {}),
          ...(scenarioId && !args.scenarioId ? { scenarioId } : {}),
        };
        const result = await invokePlanningTool(tool, mergedArgs);
        const summary = summarizeToolResult(tool, result);
        updateCopilotActivity(entry.id, {
          status: "success",
          summary,
          detail: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        });
        onToolComplete?.();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        updateCopilotActivity(entry.id, {
          status: "error",
          summary: message,
        });
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [onToolComplete, projectId, router, scenarioId]
  );

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    const route = routePlannerQuery(trimmed, { hasProject });
    setQuery("");
    if (route.kind === "message") {
      appendCopilotActivity({
        tool: "planner",
        query: trimmed,
        status: "success",
        summary: route.message,
      });
      return;
    }
    await runTool(route.tool, route.args, trimmed);
  }

  function handleSuggestion(suggestion: PlannerSuggestion) {
    if (suggestion.tool === "__navigate__") {
      void runTool(suggestion.tool, suggestion.args ?? {}, suggestion.label);
      return;
    }
    if (suggestion.requiresProject && !hasProject) return;
    void runTool(suggestion.tool, suggestion.args ?? {}, suggestion.label);
  }

  const compact = variant === "sidebar";

  return (
    <section
      className={`flex flex-col min-h-0 ${className}`}
      aria-label="Urban Planning Copilot"
      data-testid="urban-planning-copilot"
    >
      <header className="shrink-0 border-b border-outline-variant bg-surface-container-low px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-headline-md text-primary-container flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]" aria-hidden>
                smart_toy
              </span>
              Urban Planning Copilot
            </h2>
            <p className="text-caption text-on-surface-variant mt-0.5">
              {hasProject
                ? "Ask questions or run planning tools — results appear in Agent activity."
                : "Start here without a project — open or create a workspace for analysis tools."}
            </p>
          </div>
        </div>
      </header>

      <div className={`flex-1 min-h-0 overflow-y-auto ${compact ? "p-3" : "p-4"} space-y-4`}>
        {showActivityFeed && (
          <div>
            <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
              Agent activity
            </h3>
            {activity.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                Tool runs and answers will appear here with progress, errors, and results.
              </p>
            ) : (
              <ul className="space-y-2" aria-live="polite">
                {activity.slice(0, compact ? 6 : 10).map((entry) => (
                  <li
                    key={entry.id}
                    className={`border rounded p-2 text-body-sm ${
                      entry.status === "error"
                        ? "border-error/40 bg-error-container/10"
                        : entry.status === "running"
                          ? "border-primary/30 bg-primary-fixed/10"
                          : "border-outline-variant bg-surface-container-lowest"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-[10px] uppercase text-on-surface-variant">
                        {entry.tool === "planner" ? "Copilot" : toolLabel(entry.tool)}
                        {entry.tool !== "planner" && entry.tool !== "navigate" && (
                          <span className="ml-1 text-outline">
                            · {groupIdForTool(entry.tool)}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-outline">
                        {formatLocaleTime(entry.timestamp)}
                      </span>
                    </div>
                    {entry.query && (
                      <p className="text-caption text-on-surface-variant mb-1">
                        &ldquo;{entry.query}&rdquo;
                      </p>
                    )}
                    <p>{entry.summary}</p>
                    {entry.status === "running" && (
                      <p className="text-caption text-primary mt-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] animate-spin">
                          progress_activity
                        </span>
                        Working…
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
            Suggestions
          </h3>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                disabled={busy || (suggestion.requiresProject && !hasProject)}
                onClick={() => handleSuggestion(suggestion)}
                className="text-left text-caption border border-outline-variant rounded px-2.5 py-1.5 hover:border-primary hover:bg-surface-container disabled:opacity-50"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
            Tools
          </h3>
          <div className="space-y-1">
            {toolGroups.map((group) => (
              <div key={group.id} className="border border-outline-variant rounded">
                <button
                  type="button"
                  aria-expanded={expandedGroup === group.id}
                  onClick={() =>
                    setExpandedGroup((current) => (current === group.id ? null : group.id))
                  }
                  className="w-full flex items-center justify-between px-3 py-2 text-body-sm hover:bg-surface-container"
                >
                  <span className="font-medium">{group.label}</span>
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {group.tools.length} · {expandedGroup === group.id ? "▾" : "▸"}
                  </span>
                </button>
                {expandedGroup === group.id && (
                  <ul className="border-t border-outline-variant divide-y divide-outline-variant/60">
                    {group.tools.map((toolName) => (
                      <li key={toolName}>
                        <button
                          type="button"
                          disabled={busy || (group.id !== "projects" && !hasProject)}
                          title={toolDescription(toolName)}
                          onClick={() => void runTool(toolName, {}, toolLabel(toolName))}
                          className="w-full text-left px-3 py-2 text-caption hover:bg-surface-container disabled:opacity-50"
                        >
                          <span className="font-mono text-[11px]">{toolLabel(toolName)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="shrink-0 border-t border-outline-variant bg-surface-container-lowest p-3 space-y-2"
      >
        {error && (
          <p role="alert" className="text-caption text-error">
            {error}
          </p>
        )}
        <label className="sr-only" htmlFor="urban-planning-copilot-input">
          Ask Urban Planning Copilot
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="urban-planning-copilot-input"
            type="text"
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              hasProject
                ? "Ask about this workspace…"
                : "Ask without a project — e.g. list datasets"
            }
            className="flex-1 min-w-0 border border-outline-variant bg-surface px-3 py-2 text-body-sm rounded focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium disabled:opacity-50 shrink-0"
          >
            {busy ? "…" : "Ask"}
          </button>
        </div>
        <p className="text-[10px] text-on-surface-variant">
          nekuda WebMCP Workbench remains available for debugging (Alt+K) — this panel is the
          in-app planner.
        </p>
      </form>
    </section>
  );
}

/** Feed entries for embedding in the workspace Agent activity panel. */
export function CopilotActivityFeed({
  limit = 4,
  className = "",
}: {
  limit?: number;
  className?: string;
}) {
  const [activity, setActivity] = useState<CopilotActivityEntry[]>(() =>
    typeof window !== "undefined" ? listCopilotActivity() : []
  );

  useEffect(() => onCopilotActivity((detail) => setActivity(detail.entries)), []);

  const recent = activity.filter((e) => e.tool !== "planner" && e.tool !== "navigate").slice(0, limit);
  if (recent.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="font-mono text-data-label text-on-surface-variant uppercase mb-2 border-b border-outline-variant pb-2">
        Copilot tool runs
      </h3>
      <ul className="space-y-2">
        {recent.map((entry) => (
          <li key={entry.id} className="text-body-sm">
            <div className="font-mono text-[10px] text-on-surface-variant mb-0.5">
              {formatLocaleTime(entry.timestamp)} · {toolLabel(entry.tool)}
            </div>
            <p
              className={
                entry.status === "error"
                  ? "text-error"
                  : entry.status === "running"
                    ? "text-primary"
                    : undefined
              }
            >
              {entry.summary}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
