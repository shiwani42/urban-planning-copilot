import type { JsonSchema, WebMcpAnnotations } from "./browser-types";

export type ToolLayer = "answer" | "action" | "sensitive";

export type PlanningToolMeta = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpAnnotations;
  layer: ToolLayer;
};

const PROJECT_ID = {
  type: "string" as const,
  description:
    "Planning project id. Optional when a workspace tab is open — defaults to the active project.",
};

const SCENARIO_ID = {
  type: "string" as const,
  description:
    "Scenario id. Optional when a workspace tab is open — defaults to the active scenario.",
};

/** Canonical WebMCP tool catalog — shared by browser registration and HTTP /api/mcp */
export const PLANNING_TOOL_META: PlanningToolMeta[] = [
  {
    layer: "answer",
    name: "get_workspace",
    description:
      "Read the active project and currently active scenario only: objective, constraints, decision status, resume note, and analysis summary. Call list_scenarios for all branches.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "get_analysis_plan",
    description: "Return the structured analysis plan steps before or after running analysis.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
      },
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "list_candidates",
    description:
      "List ranked analysis candidates (top N by default) with total count and score spread — does not return the full candidate set. For housing capacity and detailed metrics per site, call inspect_candidate.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        limit: {
          type: "number",
          description: "Max candidates to return (default 10, max 100)",
        },
        offset: {
          type: "number",
          description: "Skip this many ranked candidates before returning the page (default 0)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "inspect_candidate",
    description:
      "Inspect one candidate: metrics, score breakdown, datasets, assumptions, limitations.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        candidateId: {
          type: "string",
          description: "Ranked candidate id from list_candidates or inspect_candidate",
        },
        scenarioId: SCENARIO_ID,
      },
      required: ["candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "list_shortlist",
    description:
      "List planner-pinned candidates on the scenario shortlist with pin reasons and notes.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
      },
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "add_to_shortlist",
    description: "Pin a ranked candidate to the scenario shortlist for decision review.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        candidateId: {
          type: "string",
          description: "Ranked candidate id from list_candidates or inspect_candidate",
        },
        reason: { type: "string", description: "Why this site was pinned" },
        note: { type: "string", description: "Optional one-line planner note" },
      },
      required: ["candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "remove_from_shortlist",
    description: "Remove a candidate from the scenario shortlist.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        candidateId: {
          type: "string",
          description: "Ranked candidate id from list_candidates or inspect_candidate",
        },
      },
      required: ["candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "list_scenarios",
    description:
      "List all scenario branches for a project: id, name, active flag, whether results exist, stale flag, and decision status.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "list_datasets",
    description: "List datasets with version, freshness, coverage, and limitations.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    layer: "answer",
    name: "get_planning_constraints",
    description:
      "One-shot read of planning constraints for the active scenario: objective, enabled constraints, dataset limitations, flood/transit thresholds, stale flag, and housing target vs eligible capacity.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
      },
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "list_decisions",
    description:
      "Recent planner decisions and scenario preferences (approvals, rejections, candidate rejections, prefer_scenario). Use for audit — get_workspace only shows decisionStatus on the active scenario.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: {
          type: "string",
          description: "Optional — filter to one scenario; omit for all branches",
        },
        limit: {
          type: "number",
          description: "Max decisions to return (default 20, max 100)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "compare_scenarios",
    description:
      "Compare scenarios using consistent calculated metrics (capacity, transit, scores). Requires two scenario IDs from list_scenarios with hasResults: true.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioIds: {
          type: "array",
          items: { type: "string" },
          description: "At least two scenario ids",
        },
      },
      required: ["scenarioIds"],
      additionalProperties: false,
    },
  },
  {
    layer: "answer",
    name: "verify_operation",
    description:
      "Verify an approved human-gated operation by SHA-256 receipt. Returns verification status.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        proposalId: { type: "string", description: "Optional; defaults to latest approved" },
      },
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "start_planning_project",
    description:
      "Create a planning project, navigate the browser to its workspace URL, and return projectId plus workspaceUrl. Geography data is Mission/SoMa, San Francisco.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name" },
        objectiveText: { type: "string", description: "Natural-language planning question" },
        geographyLabel: { type: "string", description: "Optional geography label" },
      },
      required: ["name", "objectiveText"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "open_project",
    description:
      "Open an existing planning project in the browser (navigates to its workspace URL). Pass projectId or name (case-insensitive; unique partial match allowed).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Planning project id from list_projects",
        },
        name: {
          type: "string",
          description: "Project display name when projectId is unknown",
        },
      },
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_planning_objective",
    description: "Update the active objective from natural language; regenerates the analysis plan.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        objectiveText: {
          type: "string",
          description: "Natural-language planning objective replacing the active scenario objective",
        },
        confirmConstraintChange: {
          type: "boolean",
          description:
            "Set true after planner review when the new objective would drop enabled flood/transit constraints",
        },
      },
      required: ["objectiveText"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_transit_threshold",
    description: "Set transit proximity threshold in meters (marks results stale).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        meters: { type: "number", description: "Distance threshold in meters", minimum: 1 },
      },
      required: ["meters"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_priority_weights",
    description:
      "Set ranking weights (e.g. transit, capacity, flood_resilience). Values are normalized.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        weights: {
          type: "object",
          description: "Map of criterion key → weight",
          additionalProperties: { type: "number" },
        },
      },
      required: ["weights"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "run_analysis",
    description:
      "Run spatial analysis for a scenario. Returns running — poll list_candidates or get_workspace; do not re-run on stale Client Demo if results exist.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
      },
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "create_scenario_branch",
    description:
      "Duplicate a scenario so edits do not mutate the parent. Call set_active_scenario to work on the new branch.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        name: {
          type: "string",
          description: 'Display name for the new scenario branch (e.g. "Transit 900m variant").',
        },
        fromScenarioId: {
          type: "string",
          description: "Source scenario to duplicate; defaults to active scenario",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_active_scenario",
    description:
      "Switch the workspace to a scenario branch (same as the header scenario picker). Use before run_analysis or list_candidates on a non-active branch.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
      },
      required: ["scenarioId"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "open_workspace_tab",
    description:
      "Switch the workspace UI to a tab. Requires the project workspace to be open in the browser.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        tab: {
          type: "string",
          description:
            "Tab to open: workspace (map), results, evidence, compare, decision, activity, or report",
          enum: [
            "workspace",
            "results",
            "evidence",
            "compare",
            "decision",
            "activity",
            "report",
          ],
        },
      },
      required: ["tab"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "select_candidate",
    description: "Select a candidate; syncs map highlight and detail panels.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        candidateId: {
          type: "string",
          description: "Ranked candidate id from list_candidates or inspect_candidate",
        },
      },
      required: ["candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "set_map_view",
    description:
      "Pan/zoom the workspace map viewport to a lng/lat center (optional zoom 1–20). Live map follows immediately.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        center: {
          type: "array",
          description: "[lng, lat] — exactly two numbers",
          items: { type: "number" },
        },
        zoom: { type: "number", description: "Optional zoom level (1–20)" },
      },
      required: ["center"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "exclude_features",
    description:
      "Exclude selected map parcels by feature id (same as map parcel Exclude toolbar); marks results stale.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        featureIds: {
          type: "array",
          items: { type: "string" },
          description: "Parcel feature ids from map selection",
        },
        label: { type: "string", description: "Constraint label shown in activity" },
      },
      required: ["featureIds"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "exclude_map_area",
    description: "Add a human/agent geographic exclusion polygon; marks results stale.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        label: {
          type: "string",
          description: "Human-readable label for the exclusion polygon shown in constraints",
        },
        coordinates: {
          type: "array",
          description: "Polygon ring as [lng,lat] pairs (min 3)",
          items: { type: "array", items: { type: "number" } },
        },
      },
      required: ["label", "coordinates"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "remove_map_area",
    description: "Remove a geographic exclusion/inclusion polygon by id; marks results stale.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        selectionId: {
          type: "string",
          description: "Geographic selection id returned by exclude_map_area",
        },
      },
      required: ["selectionId"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "update_map_area",
    description: "Update label or geometry of an existing geographic selection polygon.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        selectionId: {
          type: "string",
          description: "Geographic selection id to update",
        },
        label: {
          type: "string",
          description: "Updated label for the geographic selection",
        },
        coordinates: {
          type: "array",
          description: "Polygon ring as [lng,lat] pairs (min 3)",
          items: { type: "array", items: { type: "number" } },
        },
      },
      required: ["selectionId"],
      additionalProperties: false,
    },
  },
  {
    layer: "action",
    name: "stage_proposal",
    description:
      "Stage a visible ghost proposal for human review. Does not apply until approved. Revision-bound.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        title: {
          type: "string",
          description: "Short proposal title shown in the workspace review banner",
        },
        description: {
          type: "string",
          description: "Planner-facing summary of what the proposal would change",
        },
        action: {
          type: "string",
          description: "Domain action: update_weights, update_constraints, set_transit_threshold, approve_scenario",
        },
        payload: { type: "object", description: "Action-specific parameters" },
      },
      required: ["title", "description", "action", "payload"],
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "reject_candidate",
    description:
      "Record a planner rejection of a candidate. Without confirmed:true returns pending_planner for on-screen review.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        candidateId: {
          type: "string",
          description: "Ranked candidate id from list_candidates or inspect_candidate",
        },
        reason: {
          type: "string",
          description: "Optional planner rationale recorded with the rejection",
        },
        confirmed: {
          type: "boolean",
          description: "Set true after the planner confirms in the workspace UI",
        },
      },
      required: ["candidateId"],
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "prefer_scenario",
    description:
      "Select the planner's preferred scenario. Without confirmed:true returns pending_planner for on-screen review.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        reason: {
          type: "string",
          description: "Optional planner rationale for preferring this scenario",
        },
        confirmed: {
          type: "boolean",
          description: "Set true after the planner confirms in the workspace UI",
        },
      },
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "approve_scenario",
    description:
      "Use when the user says 'record decision' or 'approve scenario'; returns pending_planner until planner clicks Approve. Without confirmed:true the decision is not saved until the planner confirms in the workspace banner.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioId: SCENARIO_ID,
        reason: { type: "string", description: "Optional decision rationale" },
        confirmed: {
          type: "boolean",
          description: "Set true after the planner confirms in the workspace UI",
        },
      },
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "approve_proposal",
    description:
      "Apply a staged proposal after human confirmation. Without confirmed:true returns pending_planner with proposalId.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        proposalId: {
          type: "string",
          description: "Staged proposal id from stage_proposal awaiting planner approval",
        },
        confirmed: {
          type: "boolean",
          description: "Set true after the planner clicks Approve proposal in the UI",
        },
      },
      required: ["proposalId"],
      additionalProperties: false,
    },
  },
  {
    layer: "sensitive",
    name: "generate_report",
    description:
      "Generate a planning report for one or more scenarios. Without confirmed:true returns pending_planner for on-screen review.",
    annotations: { destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID,
        scenarioIds: {
          type: "array",
          items: { type: "string" },
          description: "Scenario ids to include; defaults to active scenario",
        },
        title: {
          type: "string",
          description: "Optional report title; defaults to a scenario-based name",
        },
      },
      additionalProperties: false,
    },
  },
];

export function getToolMeta(name: string): PlanningToolMeta | undefined {
  return PLANNING_TOOL_META.find((t) => t.name === name);
}
