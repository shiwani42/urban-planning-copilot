export type PlannerSuggestion = {
  id: string;
  label: string;
  tool: string;
  args?: Record<string, unknown>;
  /** Shown when no project is open — do not suggest project-scoped actions. */
  requiresProject?: boolean;
};

export type PlannerRouteContext = {
  hasProject: boolean;
  scenarioCount?: number;
  analyzedScenarioCount?: number;
  unanalyzedScenarioName?: string;
  scenarioIds?: string[];
  analyzedScenarioIds?: string[];
  topCandidateId?: string;
  topCandidateLabel?: string;
};

export type PlannerQueryRoute =
  | { kind: "tool"; tool: string; args: Record<string, unknown>; summary: string }
  | { kind: "message"; message: string };

const WORKSPACE_SUGGESTIONS_BASE: PlannerSuggestion[] = [
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
    id: "generate-report",
    label: "Generate report",
    tool: "generate_report",
    requiresProject: true,
  },
];

const COMPARE_SUGGESTION: PlannerSuggestion = {
  id: "compare-scenarios",
  label: "Compare scenarios",
  tool: "compare_scenarios",
  requiresProject: true,
};

const FLOOD_BRANCH_SUGGESTION: PlannerSuggestion = {
  id: "flood-branch",
  label: "Create a Flood-weighted branch",
  tool: "create_scenario_branch",
  args: { name: "Flood-weighted branch" },
  requiresProject: true,
};

const PIN_TOP_SUGGESTION: PlannerSuggestion = {
  id: "pin-top-site",
  label: "Pin top site",
  tool: "add_to_shortlist",
  requiresProject: true,
};

const EXCLUDE_AREA_SUGGESTION: PlannerSuggestion = {
  id: "exclude-area",
  label: "Exclude area",
  tool: "__copilot_query__",
  args: { query: "exclude this area on the map" },
  requiresProject: true,
};

/** Placeholder hint for supported natural-language commands (discoverability only). */
export const COPILOT_COMMAND_HINTS =
  "Try: pin top site · flood-weighted branch · compare · exclude area · run analysis";

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

export function plannerSuggestions(context: PlannerRouteContext | boolean): PlannerSuggestion[] {
  const ctx = typeof context === "boolean" ? { hasProject: context } : context;
  if (!ctx.hasProject) return HOME_SUGGESTIONS;

  const analyzedScenarioCount = ctx.analyzedScenarioCount ?? 0;
  const branchSuggestion =
    analyzedScenarioCount >= 2
      ? COMPARE_SUGGESTION
      : ctx.unanalyzedScenarioName
        ? {
            id: "run-analysis-branch",
            label: `Run analysis on ${ctx.unanalyzedScenarioName}`,
            tool: "run_analysis",
            requiresProject: true,
          }
        : FLOOD_BRANCH_SUGGESTION;
  return [
    PIN_TOP_SUGGESTION,
    branchSuggestion,
    EXCLUDE_AREA_SUGGESTION,
    ...WORKSPACE_SUGGESTIONS_BASE.filter((s) => s.id !== "run-analysis"),
    {
      id: "run-analysis",
      label: "Run analysis",
      tool: "run_analysis",
      requiresProject: true,
    },
  ];
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

const GENERIC_PATTERNS: Pattern[] = [
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

function requiresOpenProject(ctx: PlannerRouteContext): PlannerQueryRoute | null {
  if (ctx.hasProject) return null;
  return {
    kind: "message",
    message:
      "That action needs an open project. Create a project from the home page or open an existing workspace first.",
  };
}

function wantsPinToShortlist(q: string): boolean {
  if (wantsListShortlist(q)) {
    return false;
  }
  return (
    /\b(pin|star|favorite|favourite)\b/.test(q) ||
    /\b(add|put|move)\b.*\b(to\s+)?(the\s+)?shortlist\b/.test(q) ||
    /\bshortlist\b.*\b(top|first|best|#?1|leading)\b/.test(q) ||
    /\b(top|first|best|leading)\b.*\b(site|candidate|parcel)s?\b/.test(q)
  );
}

function wantsListShortlist(q: string): boolean {
  if (/\bshortlist\b.*\b(top|first|best|#?1|leading)\b/.test(q)) {
    return false;
  }
  return (
    /\b(list|show|view|what(?:'s| is)? on)\b.*\bshortlist\b/.test(q) ||
    /\bshortlist\b.*\b(list|show|count|sites?|candidates?|empty)\b/.test(q)
  );
}

function wantsScenarioBranch(q: string): boolean {
  return (
    /\b(duplicate|copy|branch|fork)\b/.test(q) ||
    /\bflood[- ]?weighted\b/.test(q) ||
    /\bcreate\b.*\bbranch\b/.test(q) ||
    /\bnew\b.*\bscenario\b/.test(q)
  );
}

function wantsCompare(q: string): boolean {
  return /\b(compare|diff|contrast)\b/.test(q);
}

function wantsExcludeArea(q: string): boolean {
  return (
    /\bexclude\b/.test(q) ||
    /\bexclusion\b/.test(q) ||
    /\b(draw|mark|add)\b.*\b(exclude|off[- ]limits)\b/.test(q)
  );
}

export function extractBranchName(query: string): string {
  const q = normalize(query);
  if (/\bflood[- ]?weighted\b/.test(q)) return "Flood-weighted branch";

  const quoted = query.match(/["“]([^"”]+)["”]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const named = q.match(
    /\b(?:duplicate|copy|branch|fork|create)\b(?:\s+(?:scenario|branch))?\s+(?:called|named)?\s+(.+)$/
  );
  if (named?.[1]) {
    const cleaned = named[1].replace(/\b(scenario|branch)\b/g, "").trim();
    if (cleaned.length >= 2) return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (/\bduplicate\b/.test(q)) return "Duplicate branch";
  if (/\bbranch\b/.test(q)) return "Scenario branch";
  return "Scenario branch";
}

function routePinToShortlist(q: string, ctx: PlannerRouteContext): PlannerQueryRoute | null {
  if (!wantsPinToShortlist(q)) return null;
  const blocked = requiresOpenProject(ctx);
  if (blocked) return blocked;

  if (!ctx.topCandidateId) {
    return {
      kind: "message",
      message:
        "Run analysis first so I can rank candidates, then ask to pin or shortlist the top site.",
    };
  }

  return {
    kind: "tool",
    tool: "add_to_shortlist",
    args: { candidateId: ctx.topCandidateId },
    summary: ctx.topCandidateLabel
      ? `Pin ${ctx.topCandidateLabel} to the shortlist`
      : "Pin the top-ranked candidate to the shortlist",
  };
}

function routeListShortlist(q: string, ctx: PlannerRouteContext): PlannerQueryRoute | null {
  if (!wantsListShortlist(q)) return null;
  const blocked = requiresOpenProject(ctx);
  if (blocked) return blocked;
  return {
    kind: "tool",
    tool: "list_shortlist",
    args: {},
    summary: "List pinned shortlist candidates",
  };
}

function routeScenarioBranch(q: string, ctx: PlannerRouteContext): PlannerQueryRoute | null {
  if (!wantsScenarioBranch(q)) return null;
  const blocked = requiresOpenProject(ctx);
  if (blocked) return blocked;
  const name = extractBranchName(q);
  return {
    kind: "tool",
    tool: "create_scenario_branch",
    args: { name },
    summary: `Create scenario branch “${name}”`,
  };
}

function routeCompare(q: string, ctx: PlannerRouteContext): PlannerQueryRoute | null {
  if (!wantsCompare(q)) return null;
  const blocked = requiresOpenProject(ctx);
  if (blocked) return blocked;

  const analyzedScenarioCount = ctx.analyzedScenarioCount ?? 0;
  if (analyzedScenarioCount < 2) {
    const branchName = ctx.unanalyzedScenarioName;
    return {
      kind: "message",
      message:
        analyzedScenarioCount === 0
          ? "Compare needs at least two analyzed scenarios. Run analysis on the active branch first, then create another scenario (for example a flood-weighted branch) and analyze it before comparing."
          : branchName
            ? `Compare needs at least two analyzed scenarios. Run analysis on “${branchName}” (or another branch without results), then compare again.`
            : "Compare needs at least two analyzed scenarios — run analysis on each branch you want to compare first.",
    };
  }

  const scenarioIds = ctx.analyzedScenarioIds ?? ctx.scenarioIds ?? [];
  if (scenarioIds.length < 2) {
    return {
      kind: "message",
      message:
        "I need two analyzed scenario ids to compare. Open the Compare tab to pick branches that have completed analysis.",
    };
  }

  return {
    kind: "tool",
    tool: "compare_scenarios",
    args: { scenarioIds: scenarioIds.slice(0, Math.max(2, scenarioIds.length)) },
    summary: "Compare scenarios",
  };
}

function routeExcludeArea(q: string, ctx: PlannerRouteContext): PlannerQueryRoute | null {
  if (!wantsExcludeArea(q)) return null;
  const blocked = requiresOpenProject(ctx);
  if (blocked) return blocked;
  return {
    kind: "message",
    message:
      "Exclusions are drawn on the workspace map — switch to the map tab, use the draw toolbar to outline an area, then click Add area. I cannot add an exclusion from chat without map coordinates.",
  };
}

function routeGenericPatterns(q: string, ctx: PlannerRouteContext): PlannerQueryRoute | null {
  for (const pattern of GENERIC_PATTERNS) {
    if (!pattern.re.test(q)) continue;
    if (pattern.requiresProject && !ctx.hasProject) {
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
  return null;
}

export function routePlannerQuery(query: string, context: PlannerRouteContext): PlannerQueryRoute {
  const q = normalize(query);
  if (!q) {
    return {
      kind: "message",
      message: context.hasProject
        ? "Ask about this workspace — for example “run analysis”, “pin the top site”, or “create a flood-weighted branch”."
        : "Open or create a project first, or try “list datasets” or “start a new project”.",
    };
  }

  const specialized =
    routePinToShortlist(q, context) ??
    routeListShortlist(q, context) ??
    routeScenarioBranch(q, context) ??
    routeCompare(q, context) ??
    routeExcludeArea(q, context) ??
    routeGenericPatterns(q, context);

  if (specialized) return specialized;

  return {
    kind: "message",
    message: context.hasProject
      ? "I can run workspace tools from the groups below — try a suggestion or pick a tool directly."
      : "Without an open project I can list datasets or guide you to create one. Open a workspace for analysis actions.",
  };
}

export type CopilotSummaryHints = {
  candidateLabel?: string;
  query?: string;
};

export function summarizeToolResult(
  tool: string,
  result: unknown,
  hints?: CopilotSummaryHints
): string {
  if (result && typeof result === "object" && "status" in result) {
    const status = (result as { status?: string }).status;
    if (status === "pending_planner") {
      return `${tool.replace(/_/g, " ")} is waiting for your approval in the workspace banner.`;
    }
    if (status === "running") {
      return "Analysis is running — watch Agent activity for progress.";
    }
    if (status === "incomplete") {
      const message = (result as { message?: string }).message;
      return message ?? "Compare needs at least two analyzed scenarios — run analysis on each branch first.";
    }
  }

  if (tool === "add_to_shortlist" && result && typeof result === "object") {
    const payload = result as { note?: string; shortlistCount?: number; candidateId?: string };
    const label = hints?.candidateLabel;
    const count = payload.shortlistCount;
    const countSuffix =
      typeof count === "number"
        ? ` (${count} site${count === 1 ? "" : "s"} on the shortlist)`
        : "";
    if (label) return `Pinned ${label} to the shortlist${countSuffix}.`;
    if (payload.note) return payload.note;
    return "Pinned candidate to the shortlist.";
  }

  if (tool === "remove_from_shortlist" && result && typeof result === "object") {
    const payload = result as { note?: string };
    if (payload.note) return payload.note;
    return "Removed candidate from the shortlist.";
  }

  if (tool === "create_scenario_branch" && result && typeof result === "object") {
    const payload = result as {
      name?: string;
      message?: string;
      note?: string;
      floodWeighted?: boolean;
      weightsSummary?: string;
    };
    if (payload.name) {
      const weightNote = payload.floodWeighted
        ? payload.weightsSummary
          ? ` Weights shifted (${payload.weightsSummary}) — run analysis to see a new ranking.`
          : " Flood weights were increased — run analysis to see a new ranking."
        : " Run analysis on the new branch to rank sites.";
      return `Created scenario branch “${payload.name}”. Now viewing this branch — analysis not run yet.${weightNote}`;
    }
    if (payload.message) return payload.message;
    if (payload.note) return payload.note;
  }

  if (tool === "list_shortlist" && result && typeof result === "object") {
    const payload = result as { message?: string; count?: number };
    if (payload.message) return payload.message;
    if (typeof payload.count === "number") {
      return payload.count > 0
        ? `Shortlist has ${payload.count} pinned site${payload.count === 1 ? "" : "s"}.`
        : "Shortlist is empty — pin ranked sites from Results or ask to pin the top candidate.";
    }
  }

  if (tool === "compare_scenarios" && result && typeof result === "object") {
    const payload = result as {
      metricsIdentical?: boolean;
      comparison?: Array<{ name?: string }>;
      message?: string;
    };
    if (payload.message) return payload.message;
    const names = (payload.comparison ?? [])
      .map((row) => row.name)
      .filter((name): name is string => Boolean(name));
    if (names.length >= 2) {
      return `Compared ${names.join(" vs ")}${
        payload.metricsIdentical ? " — ranking metrics are identical across branches." : "."
      }`;
    }
    return "Scenario comparison ready — open the Compare tab for the full table.";
  }

  if (tool === "exclude_map_area" && result && typeof result === "object") {
    const excluded = (result as { excluded?: string }).excluded;
    if (excluded) return `Excluded map area “${excluded}”. Results are stale until you recalculate.`;
  }

  if (tool === "get_workspace" && result && typeof result === "object") {
    const project = (result as { project?: { name?: string; resumeNote?: string } }).project;
    if (project?.name) {
      return `Workspace “${project.name}”${project.resumeNote ? ` — ${project.resumeNote}` : ""}.`;
    }
  }

  if (tool === "list_candidates" && result && typeof result === "object") {
    const candidates = (result as { candidates?: unknown[] }).candidates;
    if (Array.isArray(candidates)) {
      return `Listed ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}.`;
    }
  }

  if (tool === "run_analysis" && result && typeof result === "object") {
    const candidates = (result as { candidates?: unknown[]; candidateCount?: number }).candidates;
    const count = (result as { candidateCount?: number }).candidateCount;
    if (Array.isArray(candidates)) {
      return `Analysis complete — ${candidates.length} candidates ranked.`;
    }
    if (typeof count === "number") {
      return `Analysis complete — ${count} candidates ranked.`;
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

  if (result && typeof result === "object") {
    const note = (result as { note?: string; message?: string }).note;
    const message = (result as { message?: string }).message;
    if (typeof note === "string" && note.trim()) return note;
    if (typeof message === "string" && message.trim()) return message;
  }

  return `${tool.replace(/_/g, " ")} finished.`;
}
