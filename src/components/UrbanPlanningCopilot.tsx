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
  type PlannerRouteContext,
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
  scenarioCount?: number;
  analyzedScenarioCount?: number;
  unanalyzedScenarioName?: string;
  scenarioIds?: string[];
  analyzedScenarioIds?: string[];
  topCandidateId?: string | null;
  topCandidateLabel?: string | null;
  variant?: "sidebar" | "home";
  showActivityFeed?: boolean;
  onToolComplete?: () => void;
  className?: string;
};

function toolDescription(name: string): string {
  return PLANNING_TOOL_META.find((t) => t.name === name)?.description ?? name;
}

function isKnownPlanningTool(name: string): boolean {
  return PLANNING_TOOL_META.some((t) => t.name === name);
}

export function UrbanPlanningCopilot({
  projectId,
  scenarioId,
  scenarioCount = 0,
  analyzedScenarioCount = 0,
  unanalyzedScenarioName,
  scenarioIds = [],
  analyzedScenarioIds = [],
  topCandidateId,
  topCandidateLabel,
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [activity, setActivity] = useState<CopilotActivityEntry[]>(() =>
    typeof window !== "undefined" ? listCopilotActivity() : []
  );

  const hasProject = Boolean(projectId);
  const routeContext = useMemo<PlannerRouteContext>(
    () => ({
      hasProject,
      scenarioCount,
      analyzedScenarioCount,
      unanalyzedScenarioName,
      scenarioIds,
      analyzedScenarioIds,
      topCandidateId: topCandidateId ?? undefined,
      topCandidateLabel: topCandidateLabel ?? undefined,
    }),
    [
      hasProject,
      scenarioCount,
      analyzedScenarioCount,
      unanalyzedScenarioName,
      scenarioIds,
      analyzedScenarioIds,
      topCandidateId,
      topCandidateLabel,
    ]
  );

  const suggestions = useMemo(
    () => plannerSuggestions(routeContext),
    [routeContext]
  );
  const toolGroups = useMemo(
    () => buildCopilotToolGroups({ includeProjects: !hasProject }),
    [hasProject]
  );

  useEffect(() => onCopilotActivity((detail) => setActivity(detail.entries)), []);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

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
        setStatusMessage(`Opened ${href === "/explore" ? "Explore" : "New project"}.`);
        return;
      }

      if (!isKnownPlanningTool(tool)) {
        const message = `There is no “${tool.replace(/_/g, " ")}” tool in this workspace — pick a tool from the list below or rephrase your request.`;
        appendCopilotActivity({
          tool: "planner",
          query: userQuery,
          status: "error",
          summary: message,
        });
        setError(message);
        return;
      }

      const mergedArgs: Record<string, unknown> = {
        ...args,
        ...(projectId && !args.projectId ? { projectId } : {}),
        ...(scenarioId && !args.scenarioId ? { scenarioId } : {}),
      };

      if (tool === "add_to_shortlist" && !mergedArgs.candidateId) {
        if (topCandidateId) {
          mergedArgs.candidateId = topCandidateId;
        } else {
          const message =
            "Run analysis first so I can rank candidates, then ask to pin or shortlist the top site.";
          appendCopilotActivity({
            tool: "planner",
            query: userQuery,
            status: "error",
            summary: message,
          });
          setError(message);
          return;
        }
      }

      if (tool === "create_scenario_branch" && !mergedArgs.name) {
        mergedArgs.name = "Scenario branch";
      }

      if (tool === "compare_scenarios" && !Array.isArray(mergedArgs.scenarioIds)) {
        if (analyzedScenarioIds.length >= 2) {
          mergedArgs.scenarioIds = analyzedScenarioIds;
        } else if (scenarioIds.length >= 2) {
          mergedArgs.scenarioIds = scenarioIds;
        }
      }

      const candidateLabel =
        tool === "add_to_shortlist" &&
        mergedArgs.candidateId === topCandidateId &&
        topCandidateLabel
          ? topCandidateLabel
          : undefined;

      const entry = appendCopilotActivity({
        tool,
        query: userQuery,
        status: "running",
        summary: `Running ${toolLabel(tool)}…`,
      });
      setBusy(true);
      setError(null);
      setStatusMessage(`Running ${toolLabel(tool)}…`);
      try {
        const result = await invokePlanningTool(tool, mergedArgs);
        const summary = summarizeToolResult(tool, result, { candidateLabel, query: userQuery });
        const followUp =
          tool === "create_scenario_branch" &&
          result &&
          typeof result === "object" &&
          typeof (result as { createdScenarioId?: string }).createdScenarioId === "string" &&
          typeof (result as { name?: string }).name === "string"
            ? {
                label: `Run analysis on ${(result as { name: string }).name}`,
                tool: "run_analysis",
                args: {
                  scenarioId: (result as { createdScenarioId: string }).createdScenarioId,
                },
              }
            : undefined;
        updateCopilotActivity(entry.id, {
          status: "success",
          summary,
          followUp,
        });
        setStatusMessage(summary);
        onToolComplete?.();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        updateCopilotActivity(entry.id, {
          status: "error",
          summary: message,
        });
        setError(message);
        setStatusMessage(message);
      } finally {
        setBusy(false);
      }
    },
    [
      onToolComplete,
      projectId,
      router,
      scenarioId,
      scenarioIds,
      analyzedScenarioIds,
      topCandidateId,
      topCandidateLabel,
    ]
  );

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    const route = routePlannerQuery(trimmed, routeContext);
    setQuery("");
    if (route.kind === "message") {
      appendCopilotActivity({
        tool: "planner",
        query: trimmed,
        status: "success",
        summary: route.message,
      });
      setStatusMessage(route.message);
      setError(null);
      return;
    }
    await runTool(route.tool, route.args, trimmed);
  }

  function handleSuggestion(suggestion: PlannerSuggestion) {
    if (suggestion.tool === "__navigate__") {
      void runTool(suggestion.tool, suggestion.args ?? {}, suggestion.label);
      return;
    }
    if (suggestion.tool === "__copilot_query__") {
      const q = String(suggestion.args?.query ?? suggestion.label);
      const route = routePlannerQuery(q, routeContext);
      if (route.kind === "message") {
        appendCopilotActivity({
          tool: "planner",
          query: q,
          status: "success",
          summary: route.message,
        });
        setStatusMessage(route.message);
        setError(null);
        return;
      }
      void runTool(route.tool, route.args, q);
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
      <header className="shrink-0 border-b border-outline-variant bg-surface-container-low px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-body-sm font-medium text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden>
                smart_toy
              </span>
              Urban Planning Copilot
            </h2>
            <p className="text-caption text-on-surface-variant mt-0.5">
              {hasProject
                ? "Ask or pick a command — activity shows progress and results."
                : "No project open — explore data or start a new study."}
            </p>
          </div>
        </div>
      </header>

      <div className={`flex-1 min-h-0 overflow-y-auto ${compact ? "p-2.5" : "p-4"} space-y-3`}>
        {showActivityFeed && (
          <div>
            <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
              Agent activity
            </h3>
            {activity.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                When you run a tool or ask a question, steps appear here with Working… status and
                outcomes.
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
                          ? "border-outline-variant bg-surface-container"
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
                    {entry.status === "success" && entry.followUp && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runTool(
                            entry.followUp!.tool,
                            entry.followUp!.args ?? {},
                            entry.followUp!.label
                          )
                        }
                        className="mt-2 text-caption border border-primary text-primary rounded px-2.5 py-1 hover:bg-primary-fixed/10 disabled:opacity-50"
                      >
                        {entry.followUp.label}
                      </button>
                    )}
                    {entry.status === "running" && (
                      <p className="text-caption text-on-surface-variant mt-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] animate-spin text-primary">
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
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-1.5">
            Suggestions
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                disabled={busy || (suggestion.requiresProject && !hasProject)}
                onClick={() => handleSuggestion(suggestion)}
                className="text-left text-[11px] leading-tight border border-outline-variant/80 rounded px-2 py-1 text-on-surface-variant hover:border-outline hover:bg-surface-container disabled:opacity-50 focus-ring"
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
        {statusMessage && !error && (
          <p role="status" className="text-caption text-primary">
            {statusMessage}
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
                ? "e.g. pin top site · run analysis · compare scenarios"
                : "Ask without a project — e.g. list datasets"
            }
            className="flex-1 min-w-0 border border-outline-variant bg-surface px-3 py-2 text-body-sm rounded focus-ring focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium disabled:opacity-50 shrink-0 flex items-center gap-1.5 min-w-[5.5rem] justify-center focus-ring"
            aria-busy={busy}
          >
            {busy ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">
                  progress_activity
                </span>
                Working…
              </>
            ) : (
              "Ask"
            )}
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
      <ul className="space-y-2" aria-live="polite">
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
