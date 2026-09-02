export type PlannerSuggestion = {
  id: string;
  label: string;
  tool: string;
  args?: Record<string, unknown>;
  /** Shown when no project is open — do not suggest project-scoped actions. */
  requiresProject?: boolean;
};

export type PlannerQueryRoute =
  | { kind: "tool"; tool: string; args: Record<string, unknown>; summary: string }
  | { kind: "message"; message: string };

const WORKSPACE_SUGGESTIONS: PlannerSuggestion[] = [
  {
    id: "workspace-status",
    label: "Summarize this workspace",
    tool: "get_workspace",
    requiresProject: true,
  },
  {
    id: "analysis-plan",
    label: "Show analysis plan",
    tool: "get_analysis_plan",
    requiresProject: true,
  },
  {
    id: "run-analysis",
    label: "Run analysis",
    tool: "run_analysis",
    requiresProject: true,
  },
  {
    id: "list-candidates",
    label: "List top candidates",
    tool: "list_candidates",
    args: { limit: 5 },
    requiresProject: true,
  },
  {
    id: "compare-scenarios",
    label: "Compare scenarios",
    tool: "compare_scenarios",
    requiresProject: true,
  },
  {
    id: "generate-report",
    label: "Generate report",
    tool: "generate_report",
    requiresProject: true,
  },
];

const HOME_SUGGESTIONS: PlannerSuggestion[] = [
  {
    id: "new-project",
    label: "Start a new planning project",
    tool: "__navigate__",
    args: { href: "/new" },
  },
  {
    id: "explore",
    label: "Explore city data",
    tool: "__navigate__",
    args: { href: "/explore" },
  },
  {
    id: "list-datasets",
    label: "List available datasets",
    tool: "list_datasets",
  },
];

export function plannerSuggestions(hasProject: boolean): PlannerSuggestion[] {
  if (hasProject) return WORKSPACE_SUGGESTIONS;
  return HOME_SUGGESTIONS;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

type Pattern = {
  re: RegExp;
  tool: string;
  summary: string;
  requiresProject?: boolean;
  args?: Record<string, unknown>;
};

const PATTERNS: Pattern[] = [
  {
    re: /\b(run|start|execute)\b.*\banalys/,
    tool: "run_analysis",
    summary: "Run analysis for the active scenario",
    requiresProject: true,
  },
  {
    re: /\b(recalculate|re-run|rerun)\b/,
    tool: "run_analysis",
    summary: "Recalculate analysis for the active scenario",
    requiresProject: true,
  },
  {
    re: /\b(analysis plan|plan steps|structured plan)\b/,
    tool: "get_analysis_plan",
    summary: "Show the structured analysis plan",
    requiresProject: true,
  },
  {
    re: /\b(list|show|top)\b.*\bcandidates?\b/,
    tool: "list_candidates",
    summary: "List ranked candidates",
    requiresProject: true,
    args: { limit: 10 },
  },
  {
    re: /\bshortlist\b/,
    tool: "list_shortlist",
    summary: "List pinned shortlist candidates",
    requiresProject: true,
  },
  {
    re: /\b(compare|diff)\b.*\bscenarios?\b/,
    tool: "compare_scenarios",
    summary: "Compare scenarios",
    requiresProject: true,
  },
  {
    re: /\b(generate|create|build)\b.*\breport\b/,
    tool: "generate_report",
    summary: "Generate a planning report",
    requiresProject: true,
  },
  {
    re: /\b(workspace|project|scenario|status|summarize|summary)\b/,
    tool: "get_workspace",
    summary: "Read workspace status",
    requiresProject: true,
  },
  {
    re: /\b(list|show)\b.*\bdatasets?\b/,
    tool: "list_datasets",
    summary: "List datasets in the catalog",
  },
  {
    re: /\b(new|create|start)\b.*\bproject\b/,
    tool: "__navigate__",
    summary: "Open the new project flow",
    args: { href: "/new" },
  },
  {
    re: /\bexplore\b/,
    tool: "__navigate__",
    summary: "Open Explore",
    args: { href: "/explore" },
  },
];

export function routePlannerQuery(
  query: string,
  options: { hasProject: boolean }
): PlannerQueryRoute {
  const q = normalize(query);
  if (!q) {
    return {
      kind: "message",
      message: options.hasProject
        ? "Ask about this workspace — for example “run analysis” or “list top candidates”."
        : "Open or create a project first, or try “list datasets” or “start a new project”.",
    };
  }

  for (const pattern of PATTERNS) {
    if (!pattern.re.test(q)) continue;
    if (pattern.requiresProject && !options.hasProject) {
      return {
        kind: "message",
        message:
          "That action needs an open project. Create a project from the home page or open an existing workspace first.",
      };
    }
    if (pattern.tool === "__navigate__") {
      return {
        kind: "message",
        message: `Use the ${pattern.args?.href === "/explore" ? "Explore" : "New project"} page from the header to continue.`,
      };
    }
    return {
      kind: "tool",
      tool: pattern.tool,
      args: pattern.args ?? {},
      summary: pattern.summary,
    };
  }

  return {
    kind: "message",
    message: options.hasProject
      ? "I can run workspace tools from the groups below — try a suggestion or pick a tool directly."
      : "Without an open project I can list datasets or guide you to create one. Open a workspace for analysis actions.",
  };
}

export function summarizeToolResult(tool: string, result: unknown): string {
  if (result && typeof result === "object" && "status" in result) {
    const status = (result as { status?: string }).status;
    if (status === "pending_planner") {
      return `${tool.replace(/_/g, " ")} is waiting for your approval in the workspace banner.`;
    }
    if (status === "running") {
      return "Analysis is running — watch Agent activity for progress.";
    }
    if (status === "incomplete") {
      return "Compare needs at least two analyzed scenarios.";
    }
  }

  if (tool === "get_workspace" && result && typeof result === "object") {
    const project = (result as { project?: { name?: string; resumeNote?: string } }).project;
    if (project?.name) {
      return `Workspace “${project.name}”${project.resumeNote ? ` — ${project.resumeNote}` : ""}.`;
    }
  }

  if (tool === "list_candidates" && Array.isArray(result)) {
    return `Listed ${result.length} candidate${result.length === 1 ? "" : "s"}.`;
  }

  if (tool === "run_analysis" && result && typeof result === "object") {
    const candidates = (result as { candidates?: unknown[] }).candidates;
    if (Array.isArray(candidates)) {
      return `Analysis complete — ${candidates.length} candidates ranked.`;
    }
  }

  if (tool === "generate_report" && result && typeof result === "object") {
    const title = (result as { title?: string }).title;
    if (title) return `Report ready: ${title}`;
  }

  if (tool === "start_planning_project" && result && typeof result === "object") {
    const name = (result as { project?: { name?: string } }).project?.name;
    if (name) return `Created project “${name}”.`;
  }

  if (typeof result === "string") return result.slice(0, 240);
  try {
    const text = JSON.stringify(result);
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return `${tool.replace(/_/g, " ")} finished.`;
  }
}
