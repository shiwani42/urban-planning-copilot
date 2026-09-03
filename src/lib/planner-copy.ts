/**
 * Planner-facing UI copy — never builder, QA, or infrastructure terminology.
 */

export const PLANNER_GEOGRAPHY_LABEL = "Mission/SoMa, San Francisco";

/** Substrings that must not appear in user-visible copy. */
export const FORBIDDEN_PLANNER_COPY_RE =
  /\b(DATABASE_URL|Neon|Postgres|postgres|store\.json|ephemeral|workspace catalog|persist backend|Render\b|WebMCP|Nekuda|Stitch|nekuda|UrbanSight|civic_intelligence|XiBoAdzYqlBYb7VgWvI53|Pass\s*\d+|Persist Probe|open-data sandbox|this build)\b/i;

export function containsForbiddenPlannerCopy(text: string): boolean {
  return FORBIDDEN_PLANNER_COPY_RE.test(text);
}

/** Strip infrastructure errors before showing planners a storage message. */
export function toPlannerStorageMessage(
  raw: string | undefined | null,
  fallback: string
): string {
  if (!raw?.trim()) return fallback;
  if (containsForbiddenPlannerCopy(raw)) return fallback;
  if (/ENOENT|EACCES|EPERM|EROFS|write.?probe|catalog unreadable|storage file/i.test(raw)) {
    return fallback;
  }
  return raw.trim();
}

// —— Saving & storage banners ——

export const EPHEMERAL_SAVE_HEADING = "This study may not be saved if you leave.";
export const EPHEMERAL_SAVE_MESSAGE =
  "Projects you create in this session might not be there when you return. Export important decisions or reports if you need a permanent record.";

export const SAVE_UNAVAILABLE_HEADING = "Saving is temporarily unavailable.";
export const SAVE_UNAVAILABLE_FALLBACK =
  "Your projects could not be loaded or saved. Try again in a moment.";
export const SAVE_WRITE_FAILED_HINT =
  "New projects may not save until this is resolved.";
export const SAVE_ADMIN_HINT =
  "If this keeps happening, contact your organization's administrator.";

export const PROJECTS_MISSING_AFTER_UPDATE =
  "Some saved projects may be missing after a recent update. Reload your project list; recreate any studies that no longer appear.";

export const PROJECTS_LOAD_FAILED = "Your projects could not be loaded right now.";
export const PROJECTS_LIST_STORAGE_SUFFIX =
  " This is a saving issue — not an empty project list. Try again in a moment.";
export const EMPTY_PROJECTS_DEGRADED_HINT =
  " Saving may be limited — see the banner above before starting a new study.";
export const EMPTY_PROJECTS_HEALTHY_HINT = " Projects are saved while you work.";

// —— Server wake ——

export const SERVER_WAKE_HEADING = "Starting up…";
export const SERVER_WAKE_MESSAGE =
  "The workspace is waking after a quiet period. This can take up to a minute — retrying automatically.";

// —— Workspace load phases ——

export const WORKSPACE_LOAD_PHASES = [
  { afterMs: 0, label: "Loading your study…" },
  {
    afterMs: 2500,
    label: "Loading scenarios, results, and map layers…",
  },
  {
    afterMs: 6000,
    label: "Still loading — the server may be waking up…",
  },
  {
    afterMs: 12_000,
    label: "Taking longer than usual — retrying…",
  },
] as const;

export function workspaceLoadPhaseLabel(elapsedMs: number): string {
  let label: string = WORKSPACE_LOAD_PHASES[0].label;
  for (const phase of WORKSPACE_LOAD_PHASES) {
    if (elapsedMs >= phase.afterMs) label = phase.label;
  }
  return label;
}

export const WORKSPACE_LAYOUT_LOADING_DETAIL = "Loading your study and map…";

// —— Project availability ——

export const PROJECT_NOT_ON_SERVER_DETAIL =
  "Your saved projects may have changed while you were away. Reload the project list from home.";
export const PROJECT_UNAVAILABLE_DETAIL =
  " It may have been removed or is temporarily unavailable.";
export const PROJECT_NOT_FOUND_HELP =
  "If you were mid-analysis, check whether your other projects still appear on the home page.";

// —— New project ——

export const NEW_PROJECT_GEOGRAPHY_NOTE =
  "Mission/SoMa, San Francisco. Additional geographies are not yet available.";
export const NEW_PROJECT_DRAFT_STORAGE_RETRY =
  "Your draft is saved in this browser — retry when saving is available again.";
export const NEW_PROJECT_CREATE_VERIFY_FAILED =
  "This workspace could not be confirmed on the server. Retry when saving is available again.";

// —— Copilot ——

export const COPILOT_PANEL_FOOTER =
  "Ask about your study — pin sites, run analysis, or compare scenarios.";

// —— Explore convert names ——

const EXPLORE_SUGGESTED_NAMES: Record<string, string> = {
  transit_gap: "Transit access gaps — Mission/SoMa",
  school_gap: "School catchment gaps — Mission/SoMa",
  flood_exposure: "Flood exposure — Mission/SoMa",
  housing_siting: "Mission/SoMa infill — housing siting",
  emergency_shelter: "Emergency shelter access — Mission/SoMa",
};

export function exploreSuggestedProjectName(analysisType: string): string {
  return (
    EXPLORE_SUGGESTED_NAMES[analysisType] ??
    `Mission/SoMa study — ${analysisType.replace(/_/g, " ")}`
  );
}

/** Collect exported planner strings for regression tests. */
export function allPlannerCopyStrings(): string[] {
  return [
    PLANNER_GEOGRAPHY_LABEL,
    EPHEMERAL_SAVE_HEADING,
    EPHEMERAL_SAVE_MESSAGE,
    SAVE_UNAVAILABLE_HEADING,
    SAVE_UNAVAILABLE_FALLBACK,
    SAVE_WRITE_FAILED_HINT,
    SAVE_ADMIN_HINT,
    PROJECTS_MISSING_AFTER_UPDATE,
    PROJECTS_LOAD_FAILED,
    PROJECTS_LIST_STORAGE_SUFFIX,
    EMPTY_PROJECTS_DEGRADED_HINT,
    EMPTY_PROJECTS_HEALTHY_HINT,
    SERVER_WAKE_HEADING,
    SERVER_WAKE_MESSAGE,
    ...WORKSPACE_LOAD_PHASES.map((p) => p.label),
    WORKSPACE_LAYOUT_LOADING_DETAIL,
    PROJECT_NOT_ON_SERVER_DETAIL,
    PROJECT_UNAVAILABLE_DETAIL,
    PROJECT_NOT_FOUND_HELP,
    NEW_PROJECT_GEOGRAPHY_NOTE,
    NEW_PROJECT_DRAFT_STORAGE_RETRY,
    NEW_PROJECT_CREATE_VERIFY_FAILED,
    COPILOT_PANEL_FOOTER,
    ...Object.values(EXPLORE_SUGGESTED_NAMES),
  ];
}
