# Production Hardening Pass 10

Scope: WebMCP agent loop — persistence across reload, live UI sync after tool mutations, structured tool errors, and validation hardening for planner-facing tools.

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Refresh/direct URL loses projects | `reloadStoreFromDisk()` on `listProjects` / `getWorkspace`; server file store remains source of truth (Render disk via `DATA_DIR`) |
| 2 | WebMCP mutations do not update open UI | `upc:workspace-mutated` browser event after mutating tools; `useWorkspace` + home page listen and refetch |
| 3 | `exclude_map_area` applies then errors | Pre-validate label/geometry; `excludeMapArea` wrapper; no store write until validation passes |
| 4 | Opaque tool failures | `ToolError` with `code`, `field`, `message`; `/api/mcp` returns structured `error` object |
| 5 | `set_planning_objective` wipes requirements | Rejects empty text and destructive phrases (`delete everything`, `clear all`, …) before parsing |
| 6 | Human-gated tools self-cancel via `window.confirm` | Removed browser confirm gate; server returns `pending_human` unless `confirmed:true`; never throws `"cancelled by planner"` |
| 7 | `get_workspace` invents missing projects | `requireProject()` reloads from disk; `get_workspace` fails with `NOT_FOUND` when absent |
| 8 | `run_analysis` false-negative after success | `getAnalysisRunStatus()` recovery; returns `running` / `completed` payloads instead of throwing when results persisted |
| 9 | `start_planning_project` does not open workspace | Returns `workspaceUrl`; browser navigates via `window.location.assign` |
| 10 | Stale banner hidden after map/constraint edits | `criteriaStale` mutation hint + immediate “Results stale — recalculate” banner before refetch completes |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 6 | `set_transit_threshold` accepts nonsense | Rejects `< 1` and `> 50000` meters |
| 7 | `set_priority_weights` silent on unknown keys | Errors with `UNKNOWN_FIELD` listing valid keys |
| 8 | `compare_scenarios` with incomplete analysis | Requires `>= 2` ids; returns `status: incomplete` + “Run analysis first …” instead of em-dash table |
| 9 | `start_planning_project` missing on home | Home list refetches on workspace mutation events |
| 10 | Invalid proposal action staged | `assertProposalAction` at `stage_proposal` time |
| 11 | `select_candidate` succeeds for missing id | Validates candidate exists in latest result |
| 12 | `verify_operation` ambiguous | `status`: `nothing_to_verify` \| `pending` \| `verified` \| `failed` |
| 13 | No map viewport tool | Added `set_map_view` (`center` + optional `zoom`) |
| 14 | Human-review banner overlaps nav | Banner moved below main header; revision hash removed from title display |
| 15 | Carto “API KEY REQUIRED” without key | Fallback to Wikimedia OSM tiles when `NEXT_PUBLIC_CARTO_API_KEY` unset |
| 16 | `generate_report` / `approve_scenario` WebMCP | Structured errors propagate; existing sensitive-tool confirm flow preserved in browser |

## P2 — Fixed (cheap)

| # | Issue | Resolution |
|---|-------|------------|
| 17 | JSON string tool arguments | `parseToolArguments` accepts object or JSON string |
| 18 | Agent map edits attribution | Activity summary uses “AI agent” for `createdBy: agent` |
| 19 | Legend vs layers (parks) | Parks legend entry when parks layer visible |
| 20 | Geography banner mismatch | Map banner uses `project.geographyLabel` |

## Preserved

- Turf spatial engine
- snake_case WebMCP tool names
- Server-side JSON store on Render persistent disk
- San Francisco open-data snapshots (Pass 09)

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: open workspace → run `run_analysis` via WebMCP Workbench → UI counts update without reload → refresh URL → project still loads → home lists new projects after `start_planning_project`.
